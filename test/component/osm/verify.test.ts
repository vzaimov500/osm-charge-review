import { beforeEach, describe, expect, test } from 'vitest'
import { auditReportMarkdown } from '../../../src/audit/report'
import { revertBatch, verifyBatch } from '../../../src/audit/verify'
import { OsmApiClient } from '../../../src/osm/transport/api'
import { createBatches, runBatch, type BatchInput, type RunContext } from '../../../src/osm/upload'
import type { Decision } from '../../../src/review'
import { openDatabase, type DB } from '../../../src/store/db'
import { loadDecisions, saveDecision } from '../../../src/store/decisions'
import { FakeOsmApi } from '../../support/fakeOsmApi'

const DS = 'ds'
const info = {
  dataset_name: 'Example',
  source_url: 'https://example.org/feed',
  ref_key: 'ref:example',
}
let db: DB
let fake: FakeOsmApi
let ctx: RunContext
const decision = (over: Partial<Decision>): Decision => ({
  action: 'add',
  decidedAt: '2026-09-28T10:00:00Z',
  contentHash: 'h',
  superseded: false,
  ...over,
})

beforeEach(async () => {
  db = await openDatabase(`verify-${Math.random()}`)
  fake = new FakeOsmApi()
  fake.seed({
    type: 'node',
    id: 11,
    version: 3,
    lat: 42.7,
    lon: 23.32,
    tags: { amenity: 'charging_station', opening_hours: '24/7' },
  })
  const api = new OsmApiClient({
    target: 'sandbox',
    apiUrl: fake.base,
    token: () => 't',
    logger: () => {},
    fetchImpl: fake.fetch,
  })
  ctx = { db, api, account: 'tester', info, now: () => new Date('2026-09-29T01:00:00Z') }
})

/** Upload one create and one update; return the batch id. */
async function uploaded(): Promise<string> {
  const inputs: BatchInput[] = [
    {
      candidate: { sourceId: 'new', lat: 42.7, lon: 23.3205, tags: {} },
      decision: decision({ tags: { amenity: 'charging_station', 'ref:example': 'new' } }),
    },
    {
      candidate: { sourceId: 'upd', lat: 42.7, lon: 23.3201, tags: {} },
      decision: decision({
        action: 'update',
        target: { osmType: 'node', osmId: 11 },
        targetVersion: 3,
        tags: { fee: 'yes', 'ref:example': 'upd' },
      }),
    },
  ]
  for (const i of inputs) await saveDecision(db, DS, i.candidate.sourceId, i.decision)
  const [b] = await createBatches(db, inputs, { datasetId: DS, target: 'sandbox', info })
  await runBatch(ctx, b!.id)
  return b!.id
}
const created = () => [...fake.elements.values()].find((e) => e.tags['ref:example'] === 'new')!

describe('read-back verification', () => {
  test('everything as intended → match, batch verified', async () => {
    const id = await uploaded()
    const res = await verifyBatch(ctx, id)
    expect(res.map((r) => r.state)).toEqual(['match', 'match'])
    expect((await db.get('batch', id))!.status).toBe('verified')
    expect((await db.getAll('event')).filter((e) => e.type === 'verify_result')).toHaveLength(2)
  })

  test('someone edited another key since → partial; batch stays in flight', async () => {
    const id = await uploaded()
    fake.editByOther('node', 11, { note: 'surveyed' })
    const res = await verifyBatch(ctx, id)
    expect(res.find((r) => r.sourceId === 'upd')).toMatchObject({
      state: 'partial',
      differences: ['note: expected (absent), found surveyed'],
    })
    const b = (await db.get('batch', id))!
    expect(b.status).toBe('in_flight')
    expect(b.error).toMatch(/1 of 2 objects do not match/)
  })

  test('our value is not there → mismatch', async () => {
    const id = await uploaded()
    fake.editByOther('node', 11, { fee: 'no' })
    expect((await verifyBatch(ctx, id)).find((r) => r.sourceId === 'upd')).toMatchObject({
      state: 'mismatch',
      differences: ['fee: expected yes, found no'],
    })
  })

  test('object deleted → missing', async () => {
    const id = await uploaded()
    const c = created()
    fake.elements.set(`node/${c.id}`, { ...c, visible: false, version: 2 })
    expect((await verifyBatch(ctx, id)).find((r) => r.sourceId === 'new')!.state).toBe('missing')
  })

  test('a moved position that did not land is a mismatch', async () => {
    const id = await uploaded()
    const c = created()
    fake.elements.set(`node/${c.id}`, { ...c, lat: 43 })
    expect((await verifyBatch(ctx, id)).find((r) => r.sourceId === 'new')).toMatchObject({
      state: 'mismatch',
    })
  })

  test('a batch that was never uploaded cannot be verified', async () => {
    const inputs: BatchInput[] = [
      {
        candidate: { sourceId: 'x', lat: 1, lon: 1, tags: {} },
        decision: decision({ tags: { amenity: 'charging_station' } }),
      },
    ]
    const [b] = await createBatches(db, inputs, { datasetId: DS, target: 'sandbox', info })
    await expect(verifyBatch(ctx, b!.id)).rejects.toThrow(/nothing to verify/)
  })
})

describe('revert (a sandbox batch is reverted cleanly)', () => {
  test('restores snapshot tags exactly and deletes created objects, in its own changeset', async () => {
    const id = await uploaded()
    await verifyBatch(ctx, id)
    const c = created()
    const out = await revertBatch(ctx, id)
    expect(out.plan.manual).toEqual([])
    expect(fake.get('node', 11)!.tags).toEqual({
      amenity: 'charging_station',
      opening_hours: '24/7',
    }) // added keys removed
    expect(fake.get('node', c.id)!.visible).toBe(false)
    const cs = fake.changesets.get(out.changesetId!)!
    expect(cs.tags.comment).toMatch(/^Revert of changeset 5000/)
    expect(cs.open).toBe(false)
    expect((await db.get('batch', id))!.status).toBe('reverted')
    expect((await loadDecisions(db, DS)).get('upd')!.uploadedBatchId).toBeUndefined()
  })

  test('an object edited by another account is refused and listed', async () => {
    const id = await uploaded()
    fake.editByOther('node', 11, { note: 'surveyed' })
    const out = await revertBatch(ctx, id)
    expect(out.plan.manual).toEqual([
      {
        sourceId: 'upd',
        object: 'node/11',
        reason: 'edited since the batch (version 5, batch wrote 4)',
      },
    ])
    expect(fake.get('node', 11)!.tags).toMatchObject({ fee: 'yes', note: 'surveyed' }) // untouched
    expect(fake.get('node', created().id)!.visible).toBe(false) // the rest was reverted
    expect((await db.get('batch', id))!.error).toMatch(/1 objects need manual handling/)
  })

  test('dry run plans without writing', async () => {
    const id = await uploaded()
    const before = fake.changesets.size
    const out = await revertBatch(ctx, id, true)
    expect(out.plan.items.map((i) => i.kind).sort()).toEqual(['delete', 'restore'])
    expect(fake.changesets.size).toBe(before)
  })

  test('nothing revertible: no changeset is opened', async () => {
    const id = await uploaded()
    fake.editByOther('node', 11, { note: 'x' })
    const c = created()
    fake.elements.set(`node/${c.id}`, { ...c, visible: false, version: 2 })
    const before = fake.changesets.size
    const out = await revertBatch(ctx, id)
    expect(out.plan.items).toEqual([])
    expect(out.plan.manual.map((m) => m.reason).sort()).toEqual([
      'already deleted',
      'edited since the batch (version 5, batch wrote 4)',
    ])
    expect(fake.changesets.size).toBe(before)
  })

  test('drafts cannot be reverted', async () => {
    const inputs: BatchInput[] = [
      {
        candidate: { sourceId: 'x', lat: 1, lon: 1, tags: {} },
        decision: decision({ tags: { amenity: 'charging_station' } }),
      },
    ]
    const [b] = await createBatches(db, inputs, { datasetId: DS, target: 'sandbox', info })
    await expect(revertBatch(ctx, b!.id)).rejects.toThrow(/only uploaded batches/)
  })
})

test('audit report is pasteable Markdown with links', async () => {
  const id = await uploaded()
  await verifyBatch(ctx, id)
  const md = auditReportMarkdown('Example', await db.getAll('batch'), await db.getAll('event'), {
    webUrl: 'https://www.openstreetmap.org',
  })
  expect(md).toContain('## Example — upload log')
  expect(md).toContain('- Changeset: [5000](https://www.openstreetmap.org/changeset/5000)')
  expect(md).toContain('- Uploaded: 2 (1 added, 1 updated); excluded: 0')
  expect(md).toContain('- Verification: 2 match')
  expect(md).toContain('| upd | update | ok | [node/11](https://www.openstreetmap.org/node/11) |')
  expect((await db.get('batch', id))!.status).toBe('verified')
})
