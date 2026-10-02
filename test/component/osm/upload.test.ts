import { beforeEach, describe, expect, test } from 'vitest'
import type { Decision } from '../../../src/review'
import { ApiError, OsmApiClient } from '../../../src/osm/transport/api'
import {
  createBatches,
  dryRunOsc,
  parseDownloadedChange,
  recoverBatch,
  runBatch,
  type BatchInput,
  type RunContext,
} from '../../../src/osm/upload'
import { openDatabase, type DB } from '../../../src/store/db'
import { loadDecisions, saveDecision } from '../../../src/store/decisions'
import { FakeOsmApi } from '../../support/fakeOsmApi'

const DS = 'example-bg'
const info = {
  dataset_name: 'Example stations',
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
const addInput = (id: string, lat = 42.7, lon = 23.32): BatchInput => ({
  candidate: { sourceId: id, lat, lon, tags: { amenity: 'charging_station', 'ref:example': id } },
  decision: decision({ action: 'add', tags: { amenity: 'charging_station', 'ref:example': id } }),
})
const updInput = (
  id: string,
  osmId: number,
  changes: Record<string, string>,
  version = 3,
): BatchInput => ({
  candidate: { sourceId: id, lat: 42.7001, lon: 23.3201, tags: {} },
  decision: decision({
    action: 'update',
    target: { osmType: 'node', osmId },
    targetVersion: version,
    tags: changes,
  }),
})

async function prepare(inputs: BatchInput[]) {
  for (const i of inputs) await saveDecision(db, DS, i.candidate.sourceId, i.decision)
  return createBatches(db, inputs, {
    datasetId: DS,
    target: 'sandbox',
    info,
    now: () => new Date('2026-09-29T01:00:00Z'),
  })
}

beforeEach(async () => {
  db = await openDatabase(`upload-${Math.random()}`)
  fake = new FakeOsmApi()
  fake.seed({
    type: 'node',
    id: 11,
    version: 3,
    lat: 42.7,
    lon: 23.32,
    tags: { amenity: 'charging_station', opening_hours: '24/7' },
  })
  fake.seed({
    type: 'node',
    id: 12,
    version: 1,
    lat: 42.71,
    lon: 23.33,
    tags: { amenity: 'charging_station' },
  })
  const api = new OsmApiClient({
    target: 'sandbox',
    apiUrl: fake.base,
    token: () => 'test-token',
    logger: (e) => void db.add('network_log', e),
    fetchImpl: fake.fetch,
  })
  ctx = { db, api, account: 'sandbox_tester', info, now: () => new Date('2026-09-29T01:00:00Z') }
})

describe('happy path (read back matches intent tag for tag)', () => {
  test('creates and modifies land, links are written, changeset closed, batch awaits verification', async () => {
    const [batch] = await prepare([
      addInput('new-1'),
      updInput('upd-1', 11, { fee: 'yes', 'ref:example': 'upd-1' }),
    ])
    const out = await runBatch(ctx, batch!.id)
    expect(out).toMatchObject({ status: 'in_flight', step: 'verify', uploaded: 2, excluded: 0 })

    // Read back: the modified object keeps surveyed tags and gains exactly the changes.
    expect(fake.get('node', 11)!.tags).toEqual({
      amenity: 'charging_station',
      opening_hours: '24/7',
      fee: 'yes',
      'ref:example': 'upd-1',
    })
    const created = [...fake.elements.values()].find((e) => e.tags['ref:example'] === 'new-1')!
    expect(created.tags).toEqual({ amenity: 'charging_station', 'ref:example': 'new-1' })

    const cs = [...fake.changesets.values()][0]!
    expect(cs.open).toBe(false)
    expect(cs.tags).toMatchObject({
      comment: expect.stringContaining('1 added, 1 updated'),
      created_by: expect.stringMatching(/^osm-charge-review /),
      source: 'https://example.org/feed',
    })
    expect(cs.tags.import).toBeUndefined() // sandbox

    const links = await db.getAll('link')
    expect(links.map((l) => `${l.sourceId}→${l.osmType}/${l.osmId}`).sort()).toEqual([
      `new-1→node/${created.id}`,
      'upd-1→node/11',
    ])
    const decisions = await loadDecisions(db, DS)
    expect(decisions.get('new-1')!.uploadedBatchId).toBe(batch!.id)

    const snap = await db.getAll('snapshot')
    expect(snap).toEqual([
      {
        batchId: batch!.id,
        osmType: 'node',
        osmId: 11,
        version: 3,
        tags: { amenity: 'charging_station', opening_hours: '24/7' },
        lat: 42.7,
        lon: 23.32,
      },
    ])

    const types = (await db.getAll('event')).map((e) => e.type)
    expect(types).toEqual(
      expect.arrayContaining([
        'batch_created',
        'changeset_opened',
        'upload_item_result',
        'changeset_closed',
      ]),
    )
    const saved = await db.get('batch', batch!.id)
    expect(saved!.osc).toContain('<osmChange')
  })

  test('only writes carry the token; every request is in the network log with write bodies', async () => {
    const [batch] = await prepare([updInput('u', 11, { fee: 'yes' })])
    await runBatch(ctx, batch!.id)
    for (const r of fake.requests) expect(!!r.auth).toBe(r.method !== 'GET')
    const log = await db.getAll('network_log')
    expect(log.map((l) => `${l.method} ${new URL(l.url).pathname}`)).toEqual([
      'GET /api/0.6/nodes.json',
      'PUT /api/0.6/changeset/create',
      'POST /api/0.6/changeset/5000/upload',
      'PUT /api/0.6/changeset/5000/close',
    ])
    expect(log[2]!.requestBody).toContain('<osmChange')
    expect(log[2]!.responseBody).toContain('<diffResult')
    expect(JSON.stringify(log)).not.toContain('test-token')
  })
})

describe('re-validation', () => {
  test('an object edited since the decision is refused cleanly; the rest proceeds', async () => {
    const [batch] = await prepare([
      updInput('a', 11, { fee: 'yes' }),
      updInput('b', 12, { fee: 'no' }, 1),
    ])
    fake.editByOther('node', 11, { opening_hours: 'Mo-Fr 08:00-20:00' })
    const out = await runBatch(ctx, batch!.id)
    expect(out).toMatchObject({ uploaded: 1, excluded: 1 })
    expect(fake.get('node', 11)!.tags.fee).toBeUndefined()
    expect(fake.get('node', 12)!.tags.fee).toBe('no')
    const d = (await loadDecisions(db, DS)).get('a')!
    expect(d).toMatchObject({ superseded: true, supersededBy: 'upstream' })
    const ev = (await db.getAll('event')).find((e) => e.type === 'version_conflict')!
    expect(ev.data).toMatchObject({ object: 'node/11', expected: 3, actual: 4 })
  })

  test('a conflict racing between re-validation and upload: server rejects, the item is dropped, the rest uploads', async () => {
    const [batch] = await prepare([updInput('a', 11, { fee: 'yes' }), addInput('n')])
    fake.beforeRequest = (r) => {
      if (r.method === 'PUT' && r.path.endsWith('/changeset/create'))
        fake.editByOther('node', 11, { note: 'x' })
    }
    const out = await runBatch(ctx, batch!.id)
    expect(out).toMatchObject({ status: 'in_flight', step: 'verify', uploaded: 1, excluded: 1 })
    expect(fake.requests.filter((r) => r.path.endsWith('/upload'))).toHaveLength(2)
    expect(
      (await db.get('batch', batch!.id))!.items.find((i) => i.sourceId === 'a')!.result!.status,
    ).toBe('conflict')
  })

  test('a deleted target is excluded', async () => {
    fake.elements.set('node/12', { ...fake.get('node', 12)!, visible: false, version: 2 })
    const [batch] = await prepare([updInput('b', 12, { fee: 'no' }, 1), addInput('n')])
    const out = await runBatch(ctx, batch!.id)
    expect(out.excluded).toBe(1)
    expect(
      (await db.get('batch', batch!.id))!.items.find((i) => i.sourceId === 'b')!.result!.status,
    ).toBe('gone')
  })

  test('a target that no longer exists at all is excluded, others fetched one by one', async () => {
    const [batch] = await prepare([
      updInput('x', 999, { fee: 'no' }, 1),
      updInput('a', 11, { fee: 'yes' }),
    ])
    const out = await runBatch(ctx, batch!.id)
    expect(out).toMatchObject({ uploaded: 1, excluded: 1 })
  })

  test('an update that is already current is not sent (no no-op edits)', async () => {
    const [batch] = await prepare([updInput('a', 11, { opening_hours: '24/7' }), addInput('n')])
    await runBatch(ctx, batch!.id)
    expect(fake.get('node', 11)!.version).toBe(3)
    expect(
      (await db.get('batch', batch!.id))!.items.find((i) => i.sourceId === 'a')!.result!.status,
    ).toBe('noop')
  })

  test('if nothing is left, no changeset is opened', async () => {
    const [batch] = await prepare([updInput('a', 11, { opening_hours: '24/7' })])
    const out = await runBatch(ctx, batch!.id)
    expect(out).toMatchObject({ status: 'failed', error: expect.stringMatching(/nothing left/) })
    expect(fake.changesets.size).toBe(0)
  })
})

describe('failure mid-flight and recovery', () => {
  test('connection lost after the server applied the upload: in_flight, then Recover reconciles without re-uploading', async () => {
    const [batch] = await prepare([addInput('n1'), updInput('a', 11, { fee: 'yes' })])
    fake.dropAfterUpload = true
    const out = await runBatch(ctx, batch!.id)
    expect(out).toMatchObject({
      status: 'in_flight',
      step: 'upload',
      error: expect.stringMatching(/Recover/),
    })
    expect(await db.count('link')).toBe(0)

    const rec = await recoverBatch(ctx, batch!.id)
    expect(rec).toMatchObject({ status: 'in_flight', step: 'verify', uploaded: 2 })
    expect(fake.requests.filter((r) => r.path.endsWith('/upload'))).toHaveLength(1) // never re-sent
    expect(await db.count('link')).toBe(2)
    expect([...fake.changesets.values()][0]!.open).toBe(false)
  })

  test('connection lost before the server saw the upload: Recover finds nothing, closes, marks failed', async () => {
    const [batch] = await prepare([addInput('n1')])
    fake.beforeRequest = (r) => {
      if (r.path.endsWith('/upload')) throw new TypeError('NetworkError')
    }
    const out = await runBatch(ctx, batch!.id)
    expect(out.step).toBe('upload')
    fake.beforeRequest = undefined
    const rec = await recoverBatch(ctx, batch!.id)
    expect(rec).toMatchObject({ status: 'failed', uploaded: 0 })
    expect([...fake.changesets.values()][0]!.open).toBe(false)
    expect((await loadDecisions(db, DS)).get('n1')!.uploadedBatchId).toBeUndefined() // still ready
  })

  test('killed before the changeset was opened: Recover returns the batch to draft', async () => {
    const [batch] = await prepare([addInput('n1')])
    await db.put('batch', { ...batch!, status: 'in_flight', step: 'revalidate' })
    const rec = await recoverBatch(ctx, batch!.id)
    expect(rec.status).toBe('draft')
    expect(fake.requests).toHaveLength(0) // no changeset existed, so nothing to read back
  })

  test('recovering a batch that is not in flight is refused', async () => {
    const [batch] = await prepare([addInput('n1')])
    await expect(recoverBatch(ctx, batch!.id)).rejects.toThrow(/not in flight/)
  })

  test('a server rejection for another reason fails the batch and closes the changeset', async () => {
    const [batch] = await prepare([addInput('n1')])
    fake.beforeRequest = (r) => {
      if (r.path.endsWith('/upload')) fake.changesets.get(5000)!.open = false // e.g. closed by timeout
    }
    const out = await runBatch(ctx, batch!.id)
    expect(out).toMatchObject({ status: 'failed', error: expect.stringMatching(/HTTP 409/) })
  })
})

describe('dry run', () => {
  test('produces the osmChange without writing anything or using the token', async () => {
    const [batch] = await prepare([
      addInput('n1'),
      updInput('a', 11, { fee: 'yes' }),
      updInput('b', 12, { fee: 'no' }, 99),
    ])
    const { osc, excluded } = await dryRunOsc(ctx.api, batch!)
    expect(osc).toContain('<create>')
    expect(osc).toContain('<node id="11" version="3" lat=')
    expect(osc).not.toContain('changeset=')
    expect(excluded.map((e) => [e.item.sourceId, e.result.status])).toEqual([['b', 'conflict']])
    expect(fake.requests.every((r) => r.method === 'GET' && !r.auth)).toBe(true)
    expect(fake.changesets.size).toBe(0)
    expect((await db.get('batch', batch!.id))!.status).toBe('draft')
  })
})

describe('createBatches', () => {
  test('only ready add/update decisions; geography splits; unique negative placeholders', async () => {
    const skip: BatchInput = { ...addInput('s'), decision: decision({ action: 'skip' }) }
    const superseded: BatchInput = { ...addInput('x'), decision: decision({ superseded: true }) }
    const uploaded: BatchInput = {
      ...addInput('y'),
      decision: decision({ uploadedBatchId: 'old' }),
    }
    const batches = await prepare([
      addInput('a'),
      addInput('b', 42.701, 23.321),
      addInput('far', 43.2, 27.9),
      skip,
      superseded,
      uploaded,
    ])
    expect(batches.map((b) => b.sourceIds.sort())).toEqual([['a', 'b'], ['far']])
    expect(batches[0]!.items.map((i) => i.placeholderId)).toEqual([-1, -2])
    expect(batches[0]!.status).toBe('draft')
  })

  test('a new station is created where the reviewer placed it', async () => {
    const moved: BatchInput = {
      ...addInput('m'),
      decision: decision({
        action: 'add',
        tags: { amenity: 'charging_station', 'ref:example': 'm' },
        position: { lat: 42.7004, lon: 23.3206 },
      }),
    }
    const [batch] = await prepare([moved, addInput('n')])
    const at = Object.fromEntries(batch!.items.map((i) => [i.sourceId, [i.lat, i.lon]]))
    expect(at).toEqual({ m: [42.7004, 23.3206], n: [42.7, 23.32] })
  })

  test('a batch for one target cannot run on another target’s client', async () => {
    const [batch] = await prepare([addInput('a')])
    await db.put('batch', { ...batch!, apiTarget: 'live' })
    await expect(runBatch(ctx, batch!.id)).rejects.toThrow(/for live, client is for sandbox/)
  })

  test('the engine refuses live batches without wiki/forum URLs or a dry run (defence in depth)', async () => {
    const [batch] = await prepare([addInput('a')])
    await db.put('batch', { ...batch!, apiTarget: 'live' })
    const live = new OsmApiClient({
      target: 'live',
      apiUrl: fake.base,
      token: () => 't',
      logger: () => {},
      fetchImpl: fake.fetch,
    })
    await expect(runBatch({ ...ctx, api: live }, batch!.id)).rejects.toThrow(
      /wiki page and forum thread/,
    )
    await expect(
      runBatch({ ...ctx, api: live, wikiUrl: 'https://w', forumUrl: 'https://f' }, batch!.id),
    ).rejects.toThrow(/dry run first/)
    expect(fake.requests).toHaveLength(0)
  })

  test('running a batch twice is refused', async () => {
    const [batch] = await prepare([addInput('a')])
    await runBatch(ctx, batch!.id)
    await expect(runBatch(ctx, batch!.id)).rejects.toThrow(/not draft/)
  })
})

describe('OsmApiClient', () => {
  test('refuses absolute URLs and unauthenticated writes', async () => {
    await expect(ctx.api.request('GET', 'https://evil.example/x')).rejects.toThrow(ApiError)
    const anon = new OsmApiClient({
      target: 'sandbox',
      apiUrl: fake.base,
      token: () => null,
      logger: () => {},
      fetchImpl: fake.fetch,
    })
    await expect(anon.request('PUT', '/changeset/create', '<osm/>')).rejects.toThrow(
      /not signed in/,
    )
    await expect(anon.userDetails()).rejects.toThrow(/not signed in/)
  })

  test('user details', async () => {
    expect(await ctx.api.userDetails()).toEqual({ id: 4242, displayName: 'sandbox_tester' })
  })
})

test('parseDownloadedChange', () => {
  const els = parseDownloadedChange(
    '<osmChange><create><node id="5" version="1" changeset="1" lat="1.5" lon="2.5"><tag k="a" v="x &amp; y"/></node></create><modify><way id="7" version="3" changeset="1"></way></modify><delete><node id="8" version="2" changeset="1"/></delete></osmChange>',
  )
  expect(els).toEqual([
    { action: 'create', type: 'node', id: 5, version: 1, lat: 1.5, lon: 2.5, tags: { a: 'x & y' } },
    { action: 'modify', type: 'way', id: 7, version: 3, tags: {} },
    { action: 'delete', type: 'node', id: 8, version: 2, tags: {} },
  ])
})
