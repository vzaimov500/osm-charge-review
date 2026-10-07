import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test } from 'vitest'
import { parseCandidateText } from '../../../src/format'
import type { Decision } from '../../../src/review'
import {
  exportState,
  exportStatus,
  importState,
  readStateFile,
  StateFileError,
  STORES,
} from '../../../src/store/backup'
import { importDataset } from '../../../src/store/datasets'
import { dbNetworkLogger, openDatabase, type DB } from '../../../src/store/db'
import { loadDecisions, saveDecision } from '../../../src/store/decisions'

const text = readFileSync('test/fixtures/format/valid.json', 'utf8')
const parsed = (() => {
  const r = parseCandidateText(text)
  if (!r.ok) throw new Error('fixture')
  return r.dataset
})()
const decide = (at: string, over: Partial<Decision> = {}): Decision => ({
  action: 'reject',
  reasonCode: 'duplicate',
  decidedAt: at,
  contentHash: parsed.candidates[0]!.contentHash,
  superseded: false,
  ...over,
})

let db: DB
const fresh = () => openDatabase(`backup-${Math.random()}`)
beforeEach(async () => {
  db = await fresh()
  await importDataset(db, parsed, text, new Date('2026-09-28T10:00:00Z'))
  await saveDecision(db, 'example-bg', '1', decide('2026-09-28T11:00:00Z'))
  await saveDecision(
    db,
    'example-bg',
    '2',
    decide('2026-09-28T11:05:00Z', { action: 'add', tags: { amenity: 'charging_station' } }),
  )
  await dbNetworkLogger(db)({
    at: '2026-09-28T11:00:00Z',
    method: 'POST',
    url: 'https://op.example',
    status: 200,
    durationMs: 5,
    requestBody: 'q',
  })
})

const snapshot = async (d: DB) => {
  const out: Record<string, unknown[]> = {}
  for (const s of STORES) {
    out[s] = (await d.getAll(s)).map((r) => {
      const { seq: _seq, ...rest } = r as Record<string, unknown>
      return rest
    })
  }
  out.setting = out.setting!.filter((r) => (r as { key: string }).key !== 'lastExportAt')
  return out
}

describe('export → clear storage → import', () => {
  test('every store and every decision is intact', async () => {
    const before = await snapshot(db)
    const file = await exportState(db, new Date('2026-09-28T12:00:00Z'))
    const text2 = JSON.stringify(file)

    const empty = await fresh() // "cleared browser storage"
    const plan = await importState(empty, await readStateFile(text2))
    expect(plan.keptLocalDecisions).toBe(0)
    expect(await snapshot(empty)).toEqual(before)
    const decisions = await loadDecisions(empty, 'example-bg')
    expect(decisions.get('1')).toMatchObject({ action: 'reject', reasonCode: 'duplicate' })
    expect(decisions.get('2')).toMatchObject({ action: 'add' })
  })

  test('importing the same file twice changes nothing the second time', async () => {
    const file = await exportState(db)
    const empty = await fresh()
    await importState(empty, file)
    const plan = await importState(empty, file)
    expect(plan.write.event).toBe(0)
    expect(plan.write.network_log).toBe(0)
    expect(plan.duplicateEvents).toBe(file.stores.event.length)
    expect(await empty.count('event')).toBe(file.stores.event.length)
  })
})

describe('merging into existing storage', () => {
  test('a newer local decision is kept; an older one is replaced', async () => {
    const file = await exportState(db)
    await saveDecision(
      db,
      'example-bg',
      '1',
      decide('2026-09-28T13:00:00Z', { action: 'skip', reasonCode: undefined }),
    ) // newer, local
    const other = await fresh()
    await saveDecision(
      other,
      'example-bg',
      '2',
      decide('2026-09-28T09:00:00Z', { action: 'skip', reasonCode: undefined }),
    ) // older, local

    const planA = await importState(db, file)
    expect(planA.keptLocalDecisions).toBe(1)
    expect((await loadDecisions(db, 'example-bg')).get('1')!.action).toBe('skip')

    await importState(other, file)
    expect((await loadDecisions(other, 'example-bg')).get('2')!.action).toBe('add')
  })

  test('restore undoes later decisions, keeps uploaded ones, and leaves other datasets alone', async () => {
    const file = await exportState(db)
    // After the export: one decision changed, two new ones, one of them uploaded.
    await saveDecision(
      db,
      'example-bg',
      '1',
      decide('2026-09-28T13:00:00Z', { action: 'skip', reasonCode: undefined }),
    )
    await saveDecision(
      db,
      'example-bg',
      '3',
      decide('2026-09-28T13:01:00Z', { action: 'skip', reasonCode: undefined }),
    )
    await saveDecision(
      db,
      'example-bg',
      '4',
      decide('2026-09-28T13:02:00Z', {
        action: 'add',
        tags: { amenity: 'charging_station' },
        uploadedBatchId: 'b1',
      }),
    )
    await saveDecision(db, 'other-ds', '9', decide('2026-09-28T13:03:00Z'))
    // A changed decision that records an upload the file does not know is kept too.
    await saveDecision(
      db,
      'example-bg',
      '2',
      decide('2026-09-28T13:04:00Z', {
        action: 'add',
        tags: { amenity: 'charging_station' },
        uploadedBatchId: 'b2',
      }),
    )

    const dry = await importState(db, file, true, 'restore')
    expect(dry).toMatchObject({
      mode: 'restore',
      undoneLocalDecisions: 2,
      keptUploadedDecisions: 2,
    })
    expect((await loadDecisions(db, 'example-bg')).size).toBe(4) // dry run wrote nothing

    await importState(db, file, false, 'restore')
    const after = await loadDecisions(db, 'example-bg')
    expect([...after.keys()].sort()).toEqual(['1', '2', '4'])
    expect(after.get('1')!.action).toBe('reject') // back to the exported decision
    expect(after.get('2')!.uploadedBatchId).toBe('b2')
    expect((await loadDecisions(db, 'other-ds')).size).toBe(1)
    // The same file again: nothing left to undo.
    expect((await importState(db, file, true, 'restore')).undoneLocalDecisions).toBe(0)
  })

  test('dry run reports the plan and writes nothing', async () => {
    const file = await exportState(db)
    const empty = await fresh()
    const plan = await importState(empty, file, true)
    expect(plan.write.decision).toBe(2)
    expect(plan.write.candidate).toBe(6)
    expect(await empty.count('decision')).toBe(0)
    expect(await empty.count('event')).toBe(0)
  })
})

describe('readStateFile rejects bad files with a reason', () => {
  test.each([
    ['not json', '{', /Not a JSON/],
    ['wrong format', JSON.stringify({ format: 'x' }), /Not an osm-charge-review/],
    [
      'future version',
      JSON.stringify({ format: 'osm-charge-review-state', version: 2 }),
      /version 2/,
    ],
    ['no stores', JSON.stringify({ format: 'osm-charge-review-state', version: 1 }), /no stores/],
    [
      'missing store',
      JSON.stringify({ format: 'osm-charge-review-state', version: 1, stores: { dataset: [] } }),
      /Store "candidate" is missing/,
    ],
  ])('%s', async (_, t, msg) => {
    await expect(readStateFile(t)).rejects.toThrow(StateFileError)
    await expect(readStateFile(t)).rejects.toThrow(msg)
  })

  test('an edited file fails the checksum', async () => {
    const file = await exportState(db)
    file.stores.decision[0]!.action = 'add'
    await expect(readStateFile(JSON.stringify(file))).rejects.toThrow(/Checksum mismatch/)
  })
})

describe('export status ("last exported" turns into a warning)', () => {
  test('never exported: all decisions count', async () => {
    expect(await exportStatus(db)).toEqual({ decisionsSince: 2 })
  })

  test('decisions made after the export are counted', async () => {
    await exportState(db, new Date('2026-09-28T12:00:00Z'))
    expect(await exportStatus(db)).toEqual({
      lastExportAt: '2026-09-28T12:00:00.000Z',
      decisionsSince: 0,
    })
    await saveDecision(db, 'example-bg', '3', decide('2026-09-28T12:30:00Z'))
    expect((await exportStatus(db)).decisionsSince).toBe(1)
  })

  test('importing does not overwrite the local "last exported" time', async () => {
    const file = await exportState(db, new Date('2026-09-28T12:00:00Z'))
    const other = await fresh()
    await importState(other, file)
    expect((await exportStatus(other)).lastExportAt).toBeUndefined()
  })
})
