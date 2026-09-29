import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  loadStations,
  SandboxAreaError,
  stationsMetaKey,
} from '../../../src/osm/overpass/stationCache'
import { openDatabase, type DB } from '../../../src/store/db'

const fixture = () =>
  JSON.parse(readFileSync('test/fixtures/overpass/synthetic-sofia.json', 'utf8')) // happy-dom: import.meta.url is not file:
const bbox = { minLon: 23.2, minLat: 42.1, maxLon: 28.0, maxLat: 43.3 }

let db: DB
let t: number
let run: ReturnType<typeof vi.fn<(query: string) => Promise<unknown>>>
beforeEach(async () => {
  db = await openDatabase(`test-${Math.random()}`)
  t = Date.parse('2026-09-29T00:00:00Z')
  run = vi.fn<(query: string) => Promise<unknown>>(async () => fixture())
})

const load = (extra: Partial<Parameters<typeof loadStations>[1]> = {}) =>
  loadStations(db, {
    datasetId: 'ds',
    bbox,
    refKey: 'ref:example',
    run,
    endpoint: 'https://op.example',
    now: () => t,
    ...extra,
  })

describe('loadStations', () => {
  test('one query populates the store', async () => {
    const r = await load()
    expect(r.source).toBe('network')
    expect(run).toHaveBeenCalledTimes(1)
    expect(await db.countFromIndex('osm_object', 'datasetId', 'ds')).toBe(5)
    const meta = await db.get('fetch_meta', 'overpass:stations:ds')
    expect(meta).toMatchObject({
      count: 5,
      endpoint: 'https://op.example',
      timestampOsmBase: '2026-09-28T22:00:00Z',
    })
  })

  test('a second run within the cache window makes no request', async () => {
    await load()
    t += 29 * 60_000
    const r = await load()
    expect(run).toHaveBeenCalledTimes(1)
    expect(r.source).toBe('cache')
    expect(r.objects).toHaveLength(5)
    expect(r.objects[0]).not.toHaveProperty('datasetId')
  })

  test('after the window, a new request replaces the stored objects', async () => {
    await load()
    t += 31 * 60_000
    run.mockResolvedValueOnce({ elements: [fixture().elements[0]] })
    const r = await load()
    expect(r.source).toBe('network')
    expect(await db.countFromIndex('osm_object', 'datasetId', 'ds')).toBe(1)
  })

  test('force bypasses the window', async () => {
    await load()
    await load({ force: true })
    expect(run).toHaveBeenCalledTimes(2)
  })

  test('a different area (different query) is not served from cache', async () => {
    await load()
    await load({ bbox: { ...bbox, maxLat: 44 } })
    expect(run).toHaveBeenCalledTimes(2)
  })

  test('datasets are cached independently', async () => {
    await load()
    await load({ datasetId: 'other' })
    expect(run).toHaveBeenCalledTimes(2)
    expect(await db.countFromIndex('osm_object', 'datasetId', 'ds')).toBe(5)
  })

  test('each network fetch is recorded in the audit trail', async () => {
    await load()
    await load()
    const events = await db.getAll('event')
    expect(events.map((e) => e.type)).toEqual(['osm_fetch'])
  })

  test('a failing query leaves the previous snapshot intact', async () => {
    await load()
    t += 31 * 60_000
    run.mockRejectedValueOnce(new Error('busy'))
    await expect(load()).rejects.toThrow('busy')
    expect(await db.countFromIndex('osm_object', 'datasetId', 'ds')).toBe(5)
  })
})

describe('loadStations from the sandbox API', () => {
  const small = { minLon: 23.3, minLat: 42.6, maxLon: 23.35, maxLat: 42.65 }
  const sandboxMap = vi.fn(async () => ({
    elements: [
      {
        type: 'node',
        id: 7,
        version: 1,
        lat: 42.61,
        lon: 23.31,
        tags: { amenity: 'charging_station' },
      },
      { type: 'node', id: 8, version: 1, lat: 42.61, lon: 23.31, tags: { amenity: 'bench' } },
    ],
  }))
  beforeEach(() => sandboxMap.mockClear())

  test('reads the map call, never Overpass, and caches under its own key', async () => {
    const r = await load({ bbox: small, sandboxMap })
    expect(run).not.toHaveBeenCalled()
    expect(sandboxMap).toHaveBeenCalledTimes(1)
    expect(r.objects.map((o) => o.osmId)).toEqual([7])
    expect(await db.get('fetch_meta', stationsMetaKey('sandbox', 'ds'))).toMatchObject({ count: 1 })
    expect((await load({ bbox: small, sandboxMap })).source).toBe('cache')
    expect(sandboxMap).toHaveBeenCalledTimes(1)
  })

  test('switching source replaces the snapshot and invalidates the other cache', async () => {
    await load({ bbox: small })
    expect(await db.get('fetch_meta', stationsMetaKey('overpass', 'ds'))).toBeDefined()
    await load({ bbox: small, sandboxMap })
    expect(await db.get('fetch_meta', stationsMetaKey('overpass', 'ds'))).toBeUndefined()
    expect(await db.countFromIndex('osm_object', 'datasetId', 'ds')).toBe(1)
    // Back to Overpass: not served from the (now sandbox) rows.
    expect((await load({ bbox: small })).source).toBe('network')
    expect(await db.get('fetch_meta', stationsMetaKey('sandbox', 'ds'))).toBeUndefined()
  })

  test('areas the API would refuse are refused before any request', async () => {
    await expect(load({ sandboxMap })).rejects.toThrow(SandboxAreaError)
    expect(sandboxMap).not.toHaveBeenCalled()
  })

  test('stations without a position are recorded in the audit event', async () => {
    sandboxMap.mockResolvedValueOnce({
      elements: [{ type: 'way', id: 9, version: 1, tags: { amenity: 'charging_station' } }],
    } as never)
    await load({ bbox: small, sandboxMap })
    const [e] = await db.getAll('event')
    expect(e!.data).toMatchObject({ source: 'sandbox', unpositioned: ['way/9'] })
  })
})
