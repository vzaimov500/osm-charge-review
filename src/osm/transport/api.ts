import { loggedFetch, type NetworkLogger } from '../../audit/networkLog'
import type { BBox } from '../../geo/distance'

export type ApiTarget = 'sandbox' | 'live'

/** Sandbox and live are separate installations with separate registrations. */
export const TARGETS: Record<ApiTarget, { label: string; apiUrl: string; authUrl: string }> = {
  sandbox: {
    label: 'OSM sandbox (master.apis.dev.openstreetmap.org)',
    apiUrl: 'https://master.apis.dev.openstreetmap.org',
    authUrl: 'https://master.apis.dev.openstreetmap.org',
  },
  live: {
    label: 'LIVE OpenStreetMap (api.openstreetmap.org)',
    apiUrl: 'https://api.openstreetmap.org',
    authUrl: 'https://www.openstreetmap.org',
  },
}

export class ApiError extends Error {
  override name = 'ApiError'
  readonly status: number | null
  readonly body: string
  constructor(message: string, status: number | null, body = '') {
    super(message)
    this.status = status
    this.body = body
  }
}

export interface ApiClientOptions {
  target: ApiTarget
  /** Base URL of *this* target's API. Only tests pass something other than TARGETS[target].apiUrl. */
  apiUrl: string
  /** Token source of *this* target's authorisation. */
  token: () => string | null
  logger: NetworkLogger
  fetchImpl?: typeof fetch
}

/**
 * The only way to talk to an OSM API. A client is bound to one target: its
 * base URL and its token come from the same target, so a token can never be
 * sent to another API. Paths are relative; absolute URLs are refused.
 */
export class OsmApiClient {
  readonly target: ApiTarget
  private readonly o: ApiClientOptions

  constructor(o: ApiClientOptions) {
    this.target = o.target
    this.o = o
  }

  async request(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    path: string,
    body?: string,
  ): Promise<Response> {
    if (!path.startsWith('/') || path.startsWith('//'))
      throw new ApiError(`relative API path required, got ${path}`, null)
    const url = `${this.o.apiUrl}/api/0.6${path}`
    const headers: Record<string, string> = {}
    const write = method !== 'GET'
    if (write) {
      const token = this.o.token()
      if (!token) throw new ApiError(`not signed in to ${TARGETS[this.target].label}`, 401)
      headers.Authorization = `Bearer ${token}`
      headers['Content-Type'] = 'text/xml; charset=utf-8'
    }
    const init: RequestInit = { method, headers }
    if (body !== undefined) init.body = body
    const opts: Parameters<typeof loggedFetch>[2] = { logger: this.o.logger, recordBodies: write }
    if (this.o.fetchImpl) opts.fetchImpl = this.o.fetchImpl
    try {
      return await loggedFetch(url, init, opts)
    } catch (e) {
      throw new ApiError(`network error: ${e instanceof Error ? e.message : String(e)}`, null)
    }
  }

  /** request() that throws ApiError on any non-2xx status. */
  async ok(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    path: string,
    body?: string,
  ): Promise<string> {
    const res = await this.request(method, path, body)
    const text = await res.text()
    if (!res.ok)
      throw new ApiError(
        `${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`,
        res.status,
        text,
      )
    return text
  }

  /** Everything in a small area (the API caps it at 0.25 square degrees), as JSON. */
  async map(b: BBox): Promise<unknown> {
    const box = [b.minLon, b.minLat, b.maxLon, b.maxLat].map((n) => n.toFixed(6)).join(',')
    return JSON.parse(await this.ok('GET', `/map.json?bbox=${box}`)) as unknown
  }

  /** Authenticated read of the signed-in account (show the account before going live). */
  async userDetails(): Promise<{ id: number; displayName: string }> {
    const token = this.o.token()
    if (!token) throw new ApiError('not signed in', 401)
    const init: RequestInit = { headers: { Authorization: `Bearer ${token}` } }
    const opts: Parameters<typeof loggedFetch>[2] = { logger: this.o.logger }
    if (this.o.fetchImpl) opts.fetchImpl = this.o.fetchImpl
    const res = await loggedFetch(`${this.o.apiUrl}/api/0.6/user/details.json`, init, opts)
    if (!res.ok) throw new ApiError(`user details: HTTP ${res.status}`, res.status)
    const u = ((await res.json()) as { user: { id: number; display_name: string } }).user
    return { id: u.id, displayName: u.display_name }
  }
}
