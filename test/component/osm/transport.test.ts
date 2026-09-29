import { describe, expect, test } from 'vitest'
import { loggedFetch, type NetworkLogEntry } from '../../../src/audit/networkLog'
import { OverpassError, runOverpass } from '../../../src/osm/transport/overpass'

const collect = () => {
  const log: NetworkLogEntry[] = []
  return { log, logger: (e: NetworkLogEntry) => void log.push(e) }
}
/** Resolves with the rejection reason; fails the test if the promise resolves. */
const failure = (p: Promise<unknown>): Promise<OverpassError> =>
  p.then(
    () => {
      throw new Error('expected a rejection')
    },
    (e: OverpassError) => e,
  )
const respond = (status: number, body = '{}') =>
  (async () => new Response(body, { status })) as unknown as typeof fetch

describe('runOverpass', () => {
  test('POSTs form-encoded (no CORS preflight) and logs the query', async () => {
    const { log, logger } = collect()
    let seen: RequestInit | undefined
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      seen = init
      return new Response('{"elements":[]}', { status: 200 })
    }) as unknown as typeof fetch
    expect(await runOverpass('node(1);out;', { logger, fetchImpl })).toEqual({ elements: [] })
    expect(seen!.method).toBe('POST')
    expect((seen!.headers as Record<string, string>)['Content-Type']).toMatch(
      /^application\/x-www-form-urlencoded/,
    )
    expect(seen!.body).toBe('data=node(1)%3Bout%3B')
    expect(log[0]).toMatchObject({
      method: 'POST',
      url: 'https://overpass-api.de/api/interpreter',
      status: 200,
      requestBody: 'data=node(1)%3Bout%3B',
    })
    expect(log[0]!.responseBody).toBeUndefined()
  })

  test.each([429, 503, 504])('HTTP %i is "busy" and is not retried', async (status) => {
    const { log, logger } = collect()
    const err = await failure(runOverpass('x', { logger, fetchImpl: respond(status) }))
    expect(err).toBeInstanceOf(OverpassError)
    expect(err.busy).toBe(true)
    expect(err.message).toMatch(/busy/)
    expect(log).toHaveLength(1)
  })

  test('HTTP 400 is an error with the server message', async () => {
    const err = await failure(
      runOverpass('x', { logger: () => {}, fetchImpl: respond(400, 'parse error: line 1') }),
    )
    expect(err.busy).toBe(false)
    expect(err.message).toMatch(/parse error/)
  })

  test('network failure is logged and reported', async () => {
    const { log, logger } = collect()
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const err = await failure(runOverpass('x', { logger, fetchImpl }))
    expect(err.message).toMatch(/Network error/)
    expect(log[0]!.error).toMatch(/TypeError: Failed to fetch/)
  })

  test('timeout is reported as busy', async () => {
    const fetchImpl = (async () => {
      throw new DOMException('timed out', 'TimeoutError')
    }) as unknown as typeof fetch
    const err = await failure(runOverpass('x', { logger: () => {}, fetchImpl }))
    expect(err.busy).toBe(true)
    expect(err.message).toMatch(/did not answer in time/)
  })
})

describe('loggedFetch', () => {
  test('records bodies for writes', async () => {
    const { log, logger } = collect()
    await loggedFetch(
      'https://api.example/x',
      { method: 'put', body: '<osm/>' },
      { logger, fetchImpl: respond(200, '42'), recordBodies: true },
    )
    expect(log[0]).toMatchObject({
      method: 'PUT',
      requestBody: '<osm/>',
      responseBody: '42',
      status: 200,
    })
  })

  test('never records headers (tokens stay out of the log)', async () => {
    const { log, logger } = collect()
    await loggedFetch(
      'https://api.example/x',
      { headers: { Authorization: 'Bearer secret' } },
      { logger, fetchImpl: respond(200) },
    )
    expect(JSON.stringify(log)).not.toContain('secret')
  })
})
