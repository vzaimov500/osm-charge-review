import { loggedFetch, type NetworkLogger } from '../../audit/networkLog'

/**
 * Public Overpass instances. Only the first is used unless the operator picks
 * another: spreading load automatically across
 * instances would multiply our footprint when one is struggling.
 */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const

export class OverpassError extends Error {
  override name = 'OverpassError'
  readonly status: number | null
  /** The server is overloaded or rate-limiting: wait, then let the operator retry. */
  readonly busy: boolean
  constructor(message: string, status: number | null, busy: boolean) {
    super(message)
    this.status = status
    this.busy = busy
  }
}

export interface OverpassTransportOptions {
  endpoint?: string
  logger: NetworkLogger
  fetchImpl?: typeof fetch
  /** Client-side timeout; a little above the query's own [timeout:]. Default 150 s. */
  timeoutMs?: number
}

/**
 * POST a query. Form encoding keeps this a CORS "simple request" (no
 * preflight). Never retries by itself: on 429/504 the operator is told to wait.
 */
export async function runOverpass(query: string, o: OverpassTransportOptions): Promise<unknown> {
  const url = o.endpoint ?? OVERPASS_ENDPOINTS[0]
  let res: Response
  try {
    res = await loggedFetch(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(o.timeoutMs ?? 150_000),
      },
      { logger: o.logger, fetchImpl: o.fetchImpl, recordRequestBody: true },
    )
  } catch (e) {
    const timeout = e instanceof DOMException && e.name === 'TimeoutError'
    throw new OverpassError(
      timeout
        ? 'Overpass did not answer in time. Try again later or pick another instance.'
        : `Network error contacting Overpass: ${String(e)}`,
      null,
      timeout,
    )
  }
  if (res.status === 429 || res.status === 504 || res.status === 503) {
    throw new OverpassError(
      `Overpass is busy (HTTP ${res.status}). Wait a few minutes before retrying, or pick another instance.`,
      res.status,
      true,
    )
  }
  if (!res.ok) {
    const text = await res.text()
    throw new OverpassError(
      `Overpass error HTTP ${res.status}: ${text.slice(0, 300)}`,
      res.status,
      false,
    )
  }
  return res.json()
}
