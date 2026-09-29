import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test } from 'vitest'
import { parseCandidateText, type ParsedDataset } from '../../../src/format'
import { classifyAll, DEFAULT_MATCH_CONFIG } from '../../../src/match'
import type { Decision } from '../../../src/review'
import { openDatabase, type DB } from '../../../src/store/db'
import {
  importDataset,
  loadCandidates,
  loadDisappeared,
  sha256Hex,
} from '../../../src/store/datasets'
import {
  clearDecision,
  fromRecord,
  loadDecisions,
  saveDecision,
  toRecord,
} from '../../../src/store/decisions'
import { saveMatchRun } from '../../../src/store/matches'
import {
  checkStorage,
  isQuotaError,
  probeIndexedDb,
  requestPersistence,
} from '../../../src/store/storage'

const text = readFileSync('test/fixtures/format/valid.json', 'utf8')
const parse = (t: string): ParsedDataset => {
  const r = parseCandidateText(t)
  if (!r.ok) throw new Error('fixture invalid')
  return r.dataset
}
const mutate = (
  fn: (doc: {
    features: { properties: Record<string, unknown>; geometry: { coordinates: number[] } }[]
  }) => void,
) => {
  const doc = JSON.parse(text)
  fn(doc)
  return JSON.stringify(doc)
}
const T1 = new Date('2026-09-28T10:00:00Z')
const T2 = new Date('2026-09-29T10:00:00Z')

let name: string
let db: DB
beforeEach(async () => {
  name = `store-${Math.random()}`
  db = await openDatabase(name)
})

const decide = (over: Partial<Decision> = {}): Decision => ({
  action: 'reject',
  reasonCode: 'duplicate',
  decidedAt: '2026-09-28T11:00:00Z',
  contentHash: '',
  superseded: false,
  ...over,
})

describe('importDataset', () => {
  test('first import stores dataset and candidates', async () => {
    const s = await importDataset(db, parse(text), text, T1)
    expect(s).toMatchObject({
      datasetId: 'example-bg',
      total: 6,
      added: 6,
      changed: 0,
      disappeared: 0,
    })
    const ds = await db.get('dataset', 'example-bg')
    expect(ds!.fileHash).toBe(await sha256Hex(text))
    expect(ds!.fileHash).toMatch(/^[0-9a-f]{64}$/)
    const cands = await loadCandidates(db, 'example-bg')
    expect(cands).toHaveLength(6)
    expect(cands[0]).toMatchObject({
      firstSeen: T1.toISOString(),
      lastSeen: T1.toISOString(),
      disappeared: false,
    })
    const ev = await db.getAll('event')
    expect(ev.map((e) => e.type)).toEqual(['dataset_imported'])
    expect(ev[0]!.data).toMatchObject({
      fileHash: ds!.fileHash,
      adapter: { name: 'example-adapter' },
      added: 6,
    })
  })

  test('a changed source record supersedes its decision', async () => {
    const first = parse(text)
    await importDataset(db, first, text, T1)
    const c1 = first.candidates.find((c) => c.sourceId === '2')!
    await saveDecision(db, 'example-bg', '2', decide({ contentHash: c1.contentHash }))
    await saveDecision(
      db,
      'example-bg',
      '3',
      decide({ contentHash: first.candidates[2]!.contentHash }),
    )

    const t2 = mutate(
      (d) =>
        (d.features[1]!.properties.tags = {
          ...(d.features[1]!.properties.tags as object),
          capacity: '4',
        }),
    )
    const s = await importDataset(db, parse(t2), t2, T2)
    expect(s).toMatchObject({ added: 0, changed: 1, unchanged: 5, superseded: 1 })

    const decisions = await loadDecisions(db, 'example-bg')
    expect(decisions.get('2')!.superseded).toBe(true)
    expect(decisions.get('3')!.superseded).toBe(false)
    const cands = await loadCandidates(db, 'example-bg')
    expect(cands.find((c) => c.sourceId === '2')).toMatchObject({
      firstSeen: T1.toISOString(),
      lastSeen: T2.toISOString(),
    })
    expect((await db.getAll('event')).map((e) => e.type)).toContain('decision_superseded')
  })

  test('a display-only change does not supersede', async () => {
    const first = parse(text)
    await importDataset(db, first, text, T1)
    await saveDecision(
      db,
      'example-bg',
      '2',
      decide({ contentHash: first.candidates[1]!.contentHash }),
    )
    const t2 = mutate((d) => (d.features[1]!.properties.label = 'Renamed'))
    expect(await importDataset(db, parse(t2), t2, T2)).toMatchObject({ changed: 0, superseded: 0 })
  })

  test('re-confirming a superseded decision clears the flag', async () => {
    const first = parse(text)
    await importDataset(db, first, text, T1)
    await saveDecision(
      db,
      'example-bg',
      '2',
      decide({ contentHash: first.candidates[1]!.contentHash }),
    )
    const t2 = mutate((d) => (d.features[1]!.geometry.coordinates = [23.33, 42.7]))
    const second = parse(t2)
    await importDataset(db, second, t2, T2)
    await saveDecision(
      db,
      'example-bg',
      '2',
      decide({ contentHash: second.candidates[1]!.contentHash }),
    )
    expect((await loadDecisions(db, 'example-bg')).get('2')!.superseded).toBe(false)
  })

  test('vanished records are marked, never deleted', async () => {
    await importDataset(db, parse(text), text, T1)
    const t2 = mutate((d) => d.features.splice(4, 1))
    expect(await importDataset(db, parse(t2), t2, T2)).toMatchObject({ total: 5, disappeared: 1 })
    expect(await loadCandidates(db, 'example-bg')).toHaveLength(5)
    const gone = await loadDisappeared(db, 'example-bg')
    expect(gone.map((c) => c.sourceId)).toEqual(['5'])
    // and they stay marked on a further import without them
    expect(await importDataset(db, parse(t2), t2, T2)).toMatchObject({ disappeared: 1 })
    // and come back if the provider re-lists them
    expect(await importDataset(db, parse(text), text, T2)).toMatchObject({ disappeared: 0 })
    expect(await loadDisappeared(db, 'example-bg')).toEqual([])
  })
})

describe('decisions', () => {
  test('survive a reload (new connection to the same database)', async () => {
    await saveDecision(
      db,
      'ds',
      's1',
      decide({
        action: 'update',
        reasonCode: undefined,
        target: { osmType: 'node', osmId: 5 },
        tags: { fee: 'yes' },
        move: true,
        note: 'n',
      }),
    )
    db.close()
    const again = await openDatabase(name)
    const d = (await loadDecisions(again, 'ds')).get('s1')!
    expect(d).toEqual({
      action: 'update',
      target: { osmType: 'node', osmId: 5 },
      tags: { fee: 'yes' },
      move: true,
      note: 'n',
      decidedAt: '2026-09-28T11:00:00Z',
      contentHash: '',
      superseded: false,
    })
  })

  test('the audit trail records set, change (old and new) and clear', async () => {
    await saveDecision(db, 'ds', 's1', decide({ action: 'skip', reasonCode: undefined }))
    await saveDecision(db, 'ds', 's1', decide({ action: 'reject', reasonCode: 'in_water' }))
    await clearDecision(db, 'ds', 's1', '2026-09-28T12:00:00Z')
    await clearDecision(db, 'ds', 'never-decided', '2026-09-28T12:00:00Z')
    const ev = await db.getAll('event')
    expect(ev.map((e) => e.type)).toEqual(['decision_set', 'decision_changed', 'decision_cleared'])
    expect(ev[1]!.data).toMatchObject({
      old: { action: 'skip' },
      new: { action: 'reject', reasonCode: 'in_water' },
    })
    expect((await loadDecisions(db, 'ds')).size).toBe(0)
  })

  test('record conversion round-trips minimal decisions', () => {
    const d = decide({ action: 'skip', reasonCode: undefined })
    delete d.reasonCode
    expect(fromRecord(toRecord('ds', 's', d))).toEqual(d)
  })
})

test('saveMatchRun replaces pairs and records counts and parameters', async () => {
  const ds = parse(text)
  const objects = [
    {
      osmType: 'node' as const,
      osmId: 1,
      version: 1,
      lat: 42.6977,
      lon: 23.3219,
      tags: { amenity: 'charging_station' },
      lastEditUser: 'u',
      lastEditUid: 1,
      lastEditAt: '2020-01-01T00:00:00Z',
      changeset: 1,
    },
  ]
  const m = classifyAll(ds.candidates, objects, ds.info.ref_key, DEFAULT_MATCH_CONFIG)
  await saveMatchRun(db, 'example-bg', m, DEFAULT_MATCH_CONFIG, '2026-09-28T12:00:00Z')
  await saveMatchRun(db, 'example-bg', m, DEFAULT_MATCH_CONFIG, '2026-09-28T12:05:00Z')
  expect(await db.countFromIndex('match', 'datasetId', 'example-bg')).toBe(
    m.flatMap((x) => x.pairs).length,
  )
  const runs = (await db.getAll('event')).filter((e) => e.type === 'match_run')
  expect(runs).toHaveLength(2)
  expect(runs[0]!.data).toMatchObject({
    counts: { none: 5, possible: 1 },
    params: { probableRadiusM: 50 },
  })
})

describe('storage checks', () => {
  test('IndexedDB available in this environment', async () => {
    expect(await probeIndexedDb()).toBe(true)
  })

  test('missing or throwing IndexedDB is detected', async () => {
    expect(await probeIndexedDb(undefined as unknown as IDBFactory)).toBe(true) // default param → real one
    const throwing = {
      open: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    } as unknown as IDBFactory
    expect(await probeIndexedDb(throwing)).toBe(false)
  })

  test('status is reported without ever prompting', async () => {
    let prompted = false
    const nav = {
      storage: {
        persisted: async () => false,
        persist: async () => (prompted = true),
        estimate: async () => ({ usage: 10, quota: 100 }),
      },
    } as unknown as Navigator
    expect(await checkStorage(nav)).toMatchObject({
      indexedDb: true,
      persisted: false,
      usageBytes: 10,
      quotaBytes: 100,
    })
    expect(prompted).toBe(false)
  })

  test('requestPersistence asks, and survives refusal or absence', async () => {
    const nav = (persist: () => Promise<boolean>) =>
      ({ storage: { persist } }) as unknown as Navigator
    expect(await requestPersistence(nav(async () => true))).toBe(true)
    expect(await requestPersistence(nav(async () => false))).toBe(false)
    expect(
      await requestPersistence(
        nav(async () => {
          throw new Error('no')
        }),
      ),
    ).toBe(false)
    expect(await requestPersistence({} as Navigator)).toBe(false)
  })

  test('failing and missing APIs', async () => {
    const throwing = {
      storage: {
        persisted: async () => {
          throw new Error('x')
        },
        estimate: async () => {
          throw new Error('y')
        },
      },
    } as unknown as Navigator
    expect(await checkStorage(throwing)).toMatchObject({ persisted: false })
    expect((await checkStorage({} as Navigator)).persisted).toBeUndefined()
  })

  test('quota errors are recognised', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true)
    expect(isQuotaError(new Error('x'))).toBe(false)
  })
})
