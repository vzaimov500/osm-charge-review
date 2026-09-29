/**
 * Network log: every request to Overpass or an OSM API. For writes,
 * the complete request and response bodies — the only evidence of what was
 * actually sent. Headers are never recorded, so tokens cannot leak into it.
 */
export interface NetworkLogEntry {
  at: string
  method: string
  url: string
  status: number | null
  durationMs: number
  /** Recorded for writes (and for Overpass, the query text). */
  requestBody?: string
  /** Recorded for writes only. */
  responseBody?: string
  error?: string
}

export type NetworkLogger = (entry: NetworkLogEntry) => void | Promise<void>

export interface LoggedFetchOptions {
  logger: NetworkLogger
  fetchImpl?: typeof fetch
  now?: () => number
  /** Record request/response bodies (writes). */
  recordBodies?: boolean
  /** Record the request body only (e.g. an Overpass query). */
  recordRequestBody?: boolean
}

/** fetch() that appends one entry to the network log per request, success or failure. */
export async function loggedFetch(
  url: string,
  init: RequestInit,
  o: LoggedFetchOptions,
): Promise<Response> {
  const fetchImpl = o.fetchImpl ?? fetch
  const now = o.now ?? Date.now
  const started = now()
  const entry: NetworkLogEntry = {
    at: new Date(started).toISOString(),
    method: (init.method ?? 'GET').toUpperCase(),
    url,
    status: null,
    durationMs: 0,
  }
  if ((o.recordBodies || o.recordRequestBody) && typeof init.body === 'string')
    entry.requestBody = init.body
  try {
    const res = await fetchImpl(url, init)
    entry.status = res.status
    if (o.recordBodies) entry.responseBody = await res.clone().text()
    return res
  } catch (e) {
    entry.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    throw e
  } finally {
    entry.durationMs = now() - started
    await o.logger(entry)
  }
}
