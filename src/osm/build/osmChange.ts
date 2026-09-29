/**
 * Pure builders and parsers for the OSM API 0.6 upload. They return
 * strings and plain data; a separate module sends them.
 */
import type { OsmType } from '../types'

// ---- Elements as returned by the OSM API (JSON) --------------------------------

interface ApiBase {
  id: number
  version: number
  tags: Record<string, string>
  changeset?: number
  user?: string
  uid?: number
  timestamp?: string
  visible?: boolean
}
export interface ApiNode extends ApiBase {
  type: 'node'
  lat: number
  lon: number
}
export interface ApiWay extends ApiBase {
  type: 'way'
  nodes: number[]
}
export interface ApiRelation extends ApiBase {
  type: 'relation'
  members: { type: OsmType; ref: number; role: string }[]
}
export type ApiElement = ApiNode | ApiWay | ApiRelation

export class ApiParseError extends Error {
  override name = 'ApiParseError'
}

/** Parse `GET /api/0.6/{type}s.json?…` or `/{type}/{id}.json`. Deleted elements come back with visible=false. */
export function parseApiElements(data: unknown): ApiElement[] {
  const els = (data as { elements?: unknown } | null)?.elements
  if (!Array.isArray(els)) throw new ApiParseError('response has no elements array')
  return els.map((raw: unknown, i) => {
    const e = raw as Record<string, unknown>
    const bad = (why: string) => new ApiParseError(`element ${i}: ${why}`)
    if (typeof e.id !== 'number' || typeof e.version !== 'number')
      throw bad('missing id or version')
    const base: ApiBase = {
      id: e.id,
      version: e.version,
      tags: (e.tags ?? {}) as Record<string, string>,
    }
    for (const k of ['changeset', 'uid'] as const) if (typeof e[k] === 'number') base[k] = e[k]
    for (const k of ['user', 'timestamp'] as const) if (typeof e[k] === 'string') base[k] = e[k]
    if (typeof e.visible === 'boolean') base.visible = e.visible
    switch (e.type) {
      case 'node':
        if (base.visible === false) return { ...base, type: 'node', lat: NaN, lon: NaN }
        if (typeof e.lat !== 'number' || typeof e.lon !== 'number')
          throw bad('node without position')
        return { ...base, type: 'node', lat: e.lat, lon: e.lon }
      case 'way':
        if (!Array.isArray(e.nodes)) throw bad('way without nodes')
        return { ...base, type: 'way', nodes: e.nodes as number[] }
      case 'relation':
        if (!Array.isArray(e.members)) throw bad('relation without members')
        return { ...base, type: 'relation', members: e.members as ApiRelation['members'] }
      default:
        throw bad(`unknown type ${String(e.type)}`)
    }
  })
}

// ---- Upload items -----------------------------------------------------------------

export interface CreateItem {
  kind: 'create'
  sourceId: string
  /** Negative placeholder id, unique within the upload. */
  placeholderId: number
  lat: number
  lon: number
  tags: Record<string, string>
}

export interface ModifyItem {
  kind: 'modify'
  sourceId: string
  /** The element exactly as just re-fetched from the API. */
  current: ApiElement
  /** Keys to set. Applied over current.tags; never removes a key. */
  changes: Record<string, string>
  /** Nodes only, and only on an explicit reviewer decision. */
  moveTo?: { lat: number; lon: number }
}

/**
 * Revert-only: put an object's tags (and node position) back exactly as the
 * snapshot recorded them. The only item that can remove tags, and it is only
 * built by the revert planner from a snapshot this tool took.
 */
export interface RestoreItem {
  kind: 'restore'
  sourceId: string
  current: ApiElement
  tags: Record<string, string>
  position?: { lat: number; lon: number }
}

/** Revert-only: delete an object the tool created, at the version it created. */
export interface DeleteItem {
  kind: 'delete'
  sourceId: string
  current: ApiElement
}

export type UploadItem = CreateItem | ModifyItem | DeleteItem | RestoreItem

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
}

const coord = (n: number): string => n.toFixed(7)
/** Changeset attribute; omitted for dry-run files that JOSM opens without a changeset. */
const cs = (changeset: number | null): string =>
  changeset === null ? '' : ` changeset="${changeset}"`
const tagXml = (tags: Record<string, string>, indent: string): string =>
  Object.keys(tags)
    .sort()
    .map((k) => `${indent}<tag k="${escapeXml(k)}" v="${escapeXml(tags[k]!)}"/>`)
    .join('\n')

function elementXml(
  e: ApiElement,
  changeset: number | null,
  tags: Record<string, string>,
  pos?: { lat: number; lon: number },
): string {
  const attrs = `id="${e.id}" version="${e.version}"${cs(changeset)}`
  const t = tagXml(tags, '      ')
  switch (e.type) {
    case 'node': {
      const p = pos ?? e
      return `    <node ${attrs} lat="${coord(p.lat)}" lon="${coord(p.lon)}">${t ? `\n${t}\n    ` : ''}</node>`
    }
    case 'way': {
      const nds = e.nodes.map((r) => `      <nd ref="${r}"/>`).join('\n')
      // A modify always carries tags (a change with none is refused), so no empty case here.
      return `    <way ${attrs}>\n${nds}\n${t}\n    </way>`
    }
    case 'relation': {
      const ms = e.members
        .map((m) => `      <member type="${m.type}" ref="${m.ref}" role="${escapeXml(m.role)}"/>`)
        .join('\n')
      return `    <relation ${attrs}>\n${ms}\n${t}\n    </relation>`
    }
  }
}

export class BuildError extends Error {
  override name = 'BuildError'
}

/**
 * One osmChange document with every create, modify and delete of a batch.
 * Modifies keep every existing tag and member; a modify that
 * would change nothing is refused (no-op edits must never be sent).
 */
export function buildOsmChange(
  changeset: number | null,
  items: readonly UploadItem[],
  generator: string,
): string {
  const creates: string[] = []
  const modifies: string[] = []
  const deletes: string[] = []
  const seen = new Set<string>()
  for (const it of items) {
    if (it.kind === 'create') {
      if (it.placeholderId >= 0)
        throw new BuildError(`create for ${it.sourceId} needs a negative placeholder id`)
      const key = `node/${it.placeholderId}`
      if (seen.has(key)) throw new BuildError(`duplicate placeholder ${it.placeholderId}`)
      seen.add(key)
      const t = tagXml(it.tags, '      ')
      creates.push(
        `    <node id="${it.placeholderId}" version="0"${cs(changeset)} lat="${coord(it.lat)}" lon="${coord(it.lon)}">${t ? `\n${t}\n    ` : ''}</node>`,
      )
      continue
    }
    const key = `${it.current.type}/${it.current.id}`
    if (seen.has(key)) throw new BuildError(`${key} appears twice in one upload`)
    seen.add(key)
    if (it.current.visible === false) throw new BuildError(`${key} has been deleted upstream`)
    if (it.kind === 'delete') {
      deletes.push(
        `    <${it.current.type} id="${it.current.id}" version="${it.current.version}"${cs(changeset)}${it.current.type === 'node' ? ` lat="${coord(it.current.lat)}" lon="${coord(it.current.lon)}"` : ''}/>`,
      )
      continue
    }
    if (it.kind === 'restore') {
      modifies.push(
        elementXml(
          it.current,
          changeset,
          it.tags,
          it.current.type === 'node' ? it.position : undefined,
        ),
      )
      continue
    }
    if (it.moveTo && it.current.type !== 'node')
      throw new BuildError(`${key}: only nodes can be moved`)
    const tags = { ...it.current.tags, ...it.changes }
    const changesTags = Object.entries(it.changes).some(([k, v]) => it.current.tags[k] !== v)
    const moves =
      it.moveTo !== undefined &&
      it.current.type === 'node' &&
      (coord(it.moveTo.lat) !== coord(it.current.lat) ||
        coord(it.moveTo.lon) !== coord(it.current.lon))
    if (!changesTags && !moves)
      throw new BuildError(`${key} (${it.sourceId}): modify would change nothing`)
    modifies.push(elementXml(it.current, changeset, tags, it.moveTo))
  }
  const sections = [
    creates.length ? `  <create>\n${creates.join('\n')}\n  </create>` : '',
    modifies.length ? `  <modify>\n${modifies.join('\n')}\n  </modify>` : '',
    deletes.length ? `  <delete if-unused="false">\n${deletes.join('\n')}\n  </delete>` : '',
  ].filter(Boolean)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<osmChange version="0.6" generator="${escapeXml(generator)}">\n${sections.join('\n')}\n</osmChange>\n`
}

/** `PUT /api/0.6/changeset/create` body. */
export function buildChangesetXml(tags: Record<string, string>, generator: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="${escapeXml(generator)}">\n  <changeset>\n${tagXml(tags, '    ')}\n  </changeset>\n</osm>\n`
}

export interface DiffEntry {
  type: OsmType
  oldId: number
  /** Absent for deletions. */
  newId?: number
  newVersion?: number
}

/** Parse the `<diffResult>` returned by the upload. */
export function parseDiffResult(xml: string): DiffEntry[] {
  if (!/<diffResult[\s>]/.test(xml)) throw new ApiParseError('not a diffResult document')
  const out: DiffEntry[] = []
  const re = /<(node|way|relation)\s+([^>]*?)\/?>/g
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const attrs = Object.fromEntries(
      [...m[2]!.matchAll(/([\w_]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]),
    )
    if (attrs.old_id === undefined) throw new ApiParseError(`diffResult ${m[1]} without old_id`)
    const e: DiffEntry = { type: m[1] as OsmType, oldId: Number(attrs.old_id) }
    if (attrs.new_id !== undefined) e.newId = Number(attrs.new_id)
    if (attrs.new_version !== undefined) e.newVersion = Number(attrs.new_version)
    out.push(e)
  }
  return out
}
