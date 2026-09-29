/**
 * An in-memory OSM API 0.6, enough to exercise the upload path end to end:
 * changeset create/upload/close/download, element reads, atomic uploads,
 * version conflicts (409), deleted elements (410), closed changesets.
 *
 * It understands the osmChange this tool generates (regex-level XML), not
 * arbitrary XML. Real sandbox traffic is the reference; this is the stand-in.
 */
type Type = 'node' | 'way' | 'relation'

export interface FakeElement {
  type: Type
  id: number
  version: number
  visible: boolean
  lat?: number
  lon?: number
  nodes?: number[]
  tags: Record<string, string>
  changeset: number
  user: string
  uid: number
  timestamp: string
}

interface Changeset {
  id: number
  open: boolean
  uid: number
  tags: Record<string, string>
  /** Elements as written by this changeset (for /download). */
  written: { action: 'create' | 'modify' | 'delete'; el: FakeElement }[]
}

export interface FakeRequest {
  method: string
  path: string
  body?: string
  auth?: string
}

const unxml = (s: string) =>
  s
    .replace(/&#10;/g, '\n')
    .replace(/&#9;/g, '\t')
    .replace(/&#13;/g, '\r')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
const attrs = (s: string) =>
  Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1]!, unxml(m[2]!)]))
const tagsOf = (s: string) =>
  Object.fromEntries(
    [...s.matchAll(/<tag k="([^"]*)" v="([^"]*)"\/>/g)].map((m) => [unxml(m[1]!), unxml(m[2]!)]),
  )
const cap = (t: Type) => t[0]!.toUpperCase() + t.slice(1)

export class FakeOsmApi {
  readonly base: string
  constructor(base = 'https://api.fake.test') {
    this.base = base
  }
  elements = new Map<string, FakeElement>()
  changesets = new Map<number, Changeset>()
  requests: FakeRequest[] = []
  user = { id: 4242, display_name: 'sandbox_tester' }
  private nextId: Record<Type, number> = { node: 100_000, way: 200_000, relation: 300_000 }
  private nextChangeset = 5000
  /** Simulate a connection drop *after* the server applied an upload. */
  dropAfterUpload = false
  /** Hook to change the world between requests (e.g. another mapper's edit). */
  beforeRequest?: (r: FakeRequest) => void

  seed(
    el: Omit<FakeElement, 'visible' | 'changeset' | 'user' | 'uid' | 'timestamp'> &
      Partial<FakeElement>,
  ): FakeElement {
    const full: FakeElement = {
      visible: true,
      changeset: 1,
      user: 'other_mapper',
      uid: 1,
      timestamp: '2025-01-01T00:00:00Z',
      ...el,
    }
    this.elements.set(`${el.type}/${el.id}`, full)
    return full
  }

  /** Another account edits an object (for conflict tests). */
  editByOther(type: Type, id: number, tags: Record<string, string>): void {
    const e = this.elements.get(`${type}/${id}`)!
    this.elements.set(`${type}/${id}`, {
      ...e,
      tags: { ...e.tags, ...tags },
      version: e.version + 1,
      user: 'other_mapper',
      uid: 1,
      changeset: 9,
    })
  }

  get(type: Type, id: number): FakeElement | undefined {
    return this.elements.get(`${type}/${id}`)
  }

  /** A fetch() implementation bound to this fake. */
  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    if (url.origin !== this.base) throw new TypeError(`fake API: unexpected origin ${url.origin}`)
    // Header names are case-insensitive (Playwright reports them in lower case).
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    )
    const req: FakeRequest = {
      method: (init.method ?? 'GET').toUpperCase(),
      path: url.pathname + url.search,
    }
    if (typeof init.body === 'string') req.body = init.body
    if (headers.authorization) req.auth = headers.authorization
    this.requests.push(req)
    this.beforeRequest?.(req)
    const res = this.route(req, url)
    if (
      this.dropAfterUpload &&
      req.method === 'POST' &&
      /\/upload$/.test(url.pathname) &&
      res.status === 200
    ) {
      this.dropAfterUpload = false
      throw new TypeError('NetworkError when attempting to fetch resource.')
    }
    return res
  }

  private text(status: number, body = '', type = 'text/plain'): Response {
    return new Response(body, { status, headers: { 'Content-Type': type } })
  }
  private json(v: unknown): Response {
    return new Response(JSON.stringify(v), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  private toJson(e: FakeElement): Record<string, unknown> {
    const { visible, ...rest } = e
    return visible
      ? rest
      : {
          type: e.type,
          id: e.id,
          version: e.version,
          visible: false,
          changeset: e.changeset,
          user: e.user,
          uid: e.uid,
          timestamp: e.timestamp,
        }
  }

  private route(req: FakeRequest, url: URL): Response {
    const p = url.pathname.replace(/^\/api\/0\.6/, '')
    const writes = req.method !== 'GET'
    if (writes && !req.auth?.startsWith('Bearer '))
      return this.text(401, "Couldn't authenticate you")

    if (req.method === 'GET' && p === '/user/details.json') {
      if (!req.auth) return this.text(401)
      return this.json({ user: this.user })
    }
    if (req.method === 'GET' && p === '/map.json') {
      // Like the real API: 400 over 0.25 square degrees. Nodes only, plus ways fully inside.
      const [w, so, e, n] = (url.searchParams.get('bbox') ?? '').split(',').map(Number) as [
        number,
        number,
        number,
        number,
      ]
      if ((e - w) * (n - so) > 0.25) return this.text(400, 'The maximum bbox size is 0.25')
      const inside = [...this.elements.values()].filter(
        (el) =>
          el.visible &&
          el.type === 'node' &&
          el.lon! >= w &&
          el.lon! <= e &&
          el.lat! >= so &&
          el.lat! <= n,
      )
      const ids = new Set(inside.map((el) => el.id))
      const ways = [...this.elements.values()].filter(
        (el) => el.visible && el.type === 'way' && (el.nodes ?? []).some((id) => ids.has(id)),
      )
      return this.json({ elements: [...inside, ...ways].map((el) => this.toJson(el)) })
    }
    let m = /^\/(node|way|relation)s\.json$/.exec(p)
    if (req.method === 'GET' && m) {
      const type = m[1] as Type
      const ids = (url.searchParams.get(`${type}s`) ?? '').split(',').filter(Boolean).map(Number)
      const els = ids.map((id) => this.get(type, id))
      if (els.some((e) => !e)) return this.text(404, 'not found')
      return this.json({ elements: els.map((e) => this.toJson(e!)) })
    }
    m = /^\/(node|way|relation)\/(\d+)\.json$/.exec(p)
    if (req.method === 'GET' && m) {
      const e = this.get(m[1] as Type, Number(m[2]))
      if (!e) return this.text(404)
      if (!e.visible) return this.text(410, 'Gone')
      return this.json({ elements: [this.toJson(e)] })
    }
    if (req.method === 'PUT' && p === '/changeset/create') {
      const id = this.nextChangeset++
      this.changesets.set(id, {
        id,
        open: true,
        uid: this.user.id,
        tags: tagsOf(req.body ?? ''),
        written: [],
      })
      return this.text(200, String(id))
    }
    m = /^\/changeset\/(\d+)\/(upload|close|download)$/.exec(p)
    if (m) {
      const cs = this.changesets.get(Number(m[1]))
      if (!cs) return this.text(404)
      if (m[2] === 'download' && req.method === 'GET')
        return this.text(200, this.download(cs), 'application/xml')
      if (m[2] === 'close' && req.method === 'PUT') {
        if (!cs.open)
          return this.text(409, `The changeset ${cs.id} was closed at 2026-09-29 00:00:00 UTC`)
        cs.open = false
        return this.text(200)
      }
      if (m[2] === 'upload' && req.method === 'POST') return this.upload(cs, req.body ?? '')
    }
    return this.text(404, `fake API: no route ${req.method} ${p}`)
  }

  private upload(cs: Changeset, xml: string): Response {
    if (!cs.open)
      return this.text(409, `The changeset ${cs.id} was closed at 2026-09-29 00:00:00 UTC`)
    const sections = [...xml.matchAll(/<(create|modify|delete)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)]
    // Validate everything first: uploads are atomic.
    type Op = {
      action: 'create' | 'modify' | 'delete'
      type: Type
      a: Record<string, string>
      body: string
    }
    const ops: Op[] = []
    for (const [, action, inner] of sections) {
      for (const el of inner!.matchAll(
        /<(node|way|relation)\s([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g,
      )) {
        ops.push({
          action: action as Op['action'],
          type: el[1] as Type,
          a: attrs(el[2]!),
          body: el[3] ?? '',
        })
      }
    }
    for (const op of ops) {
      if (Number(op.a.changeset) !== cs.id)
        return this.text(
          409,
          `Changeset mismatch: Provided ${op.a.changeset} but only ${cs.id} is allowed`,
        )
      if (op.action === 'create') continue
      const cur = this.get(op.type, Number(op.a.id))
      if (!cur) return this.text(404, `${cap(op.type)} ${op.a.id} not found`)
      if (!cur.visible)
        return this.text(410, `The ${op.type} with the id ${op.a.id} has already been deleted`)
      if (cur.version !== Number(op.a.version)) {
        return this.text(
          409,
          `Version mismatch: Provided ${op.a.version}, server had: ${cur.version} of ${cap(op.type)} ${op.a.id}`,
        )
      }
    }
    const lines: string[] = []
    const now = '2026-09-29T00:00:00Z'
    const meta = {
      changeset: cs.id,
      user: this.user.display_name,
      uid: this.user.id,
      timestamp: now,
    }
    for (const op of ops) {
      const tags = tagsOf(op.body)
      if (op.action === 'create') {
        const id = this.nextId[op.type]++
        const el: FakeElement = {
          type: op.type,
          id,
          version: 1,
          visible: true,
          lat: Number(op.a.lat),
          lon: Number(op.a.lon),
          tags,
          ...meta,
        }
        this.elements.set(`${op.type}/${id}`, el)
        cs.written.push({ action: 'create', el })
        lines.push(`  <${op.type} old_id="${op.a.id}" new_id="${id}" new_version="1"/>`)
      } else if (op.action === 'modify') {
        const cur = this.get(op.type, Number(op.a.id))!
        const el: FakeElement = { ...cur, version: cur.version + 1, tags, ...meta }
        if (op.type === 'node') Object.assign(el, { lat: Number(op.a.lat), lon: Number(op.a.lon) })
        this.elements.set(`${op.type}/${cur.id}`, el)
        cs.written.push({ action: 'modify', el })
        lines.push(
          `  <${op.type} old_id="${cur.id}" new_id="${cur.id}" new_version="${el.version}"/>`,
        )
      } else {
        const cur = this.get(op.type, Number(op.a.id))!
        const el: FakeElement = { ...cur, version: cur.version + 1, visible: false, ...meta }
        this.elements.set(`${op.type}/${cur.id}`, el)
        cs.written.push({ action: 'delete', el })
        lines.push(`  <${op.type} old_id="${cur.id}"/>`)
      }
    }
    return this.text(
      200,
      `<?xml version="1.0" encoding="UTF-8"?>\n<diffResult version="0.6" generator="fake">\n${lines.join('\n')}\n</diffResult>`,
      'application/xml',
    )
  }

  private download(cs: Changeset): string {
    const body = cs.written
      .map(({ action, el }) => {
        const t = Object.entries(el.tags)
          .map(([k, v]) => `<tag k="${k}" v="${v}"/>`)
          .join('')
        const pos =
          el.type === 'node' && action !== 'delete' ? ` lat="${el.lat}" lon="${el.lon}"` : ''
        return `<${action}><${el.type} id="${el.id}" version="${el.version}" changeset="${cs.id}"${pos}>${t}</${el.type}></${action}>`
      })
      .join('\n')
    return `<?xml version="1.0" encoding="UTF-8"?>\n<osmChange version="0.6" generator="fake">\n${body}\n</osmChange>`
  }
}
