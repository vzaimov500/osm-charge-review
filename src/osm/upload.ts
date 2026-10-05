/**
 * Batch upload. Every step is persisted *before* the network call
 * that depends on it, so a killed tab leaves an `in_flight` batch whose state
 * says exactly how far it got. Recovery is a separate, explicit action that
 * reads the changeset back; nothing here ever blind-retries.
 */
import type { Candidate, DatasetInfo } from '../format'
import { applyChanges, isNoopUpdate, type Decision } from '../review'
import { appendEvent, type ApiTarget, type BatchItem, type BatchRecord, type DB } from '../store/db'
import { CREATED_BY } from '../version'
import {
  changesetTags,
  oblastLabel,
  planBatches,
  planBatchesByArea,
  type BatchPlanOptions,
  type PlannedGroup,
} from './build/batch'
import {
  buildChangesetXml,
  buildOsmChange,
  parseApiElements,
  parseDiffResult,
  type ApiElement,
  type UploadItem,
} from './build/osmChange'
import { ApiError, type OsmApiClient } from './transport/api'
import type { OsmType } from './types'

export interface BatchInput {
  candidate: Pick<Candidate, 'sourceId' | 'lat' | 'lon' | 'tags'>
  decision: Decision
}

export interface CreateBatchesOptions extends BatchPlanOptions {
  datasetId: string
  target: ApiTarget
  info: Pick<DatasetInfo, 'dataset_name'>
  now?: () => Date
  /** Region name per source id, used in the changeset comment. */
  regionOf?: (sourceId: string) => string | undefined
  /** Oblast (or similar area) per source id: one batch per area, named in the comment. */
  oblastOf?: (sourceId: string) => string | undefined
  /** Plan only this many batches; the rest stay ready (a careful first live batch). */
  limit?: number
}

/** Plan batches from decided rows. Only add/update, never superseded or already uploaded. */
export async function createBatches(
  db: DB,
  inputs: readonly BatchInput[],
  o: CreateBatchesOptions,
): Promise<BatchRecord[]> {
  const eligible = inputs.filter(
    (i) =>
      (i.decision.action === 'add' || i.decision.action === 'update') &&
      !i.decision.superseded &&
      !i.decision.uploadedBatchId,
  )
  // A new station goes where the reviewer placed it, if they moved it.
  const placed = eligible.map((i) => {
    const at = (i.decision.action === 'add' ? i.decision.position : undefined) ?? i.candidate
    return { sourceId: i.candidate.sourceId, lat: at.lat, lon: at.lon, input: i }
  })
  const planned: PlannedGroup<(typeof placed)[number]>[] = o.oblastOf
    ? planBatchesByArea(placed, (p) => o.oblastOf!(p.sourceId), { maxItems: o.maxItems ?? 50 })
    : planBatches(placed, o).map((items) => ({ items }))
  const groups = o.limit === undefined ? planned : planned.slice(0, o.limit)
  const now = o.now ?? (() => new Date())
  const out: BatchRecord[] = []
  for (const { area: oblast, items: g } of groups) {
    const at = now().toISOString()
    const id = `${o.datasetId}:${at}:${out.length}`
    const items: BatchItem[] = g.map(({ input: { candidate: c, decision: d } }, i) => {
      if (d.action === 'add')
        return {
          sourceId: c.sourceId,
          kind: 'create',
          lat: (d.position ?? c).lat,
          lon: (d.position ?? c).lon,
          tags: { ...(d.tags ?? c.tags) },
          placeholderId: -(i + 1),
        }
      const item: BatchItem = {
        sourceId: c.sourceId,
        kind: 'modify',
        lat: c.lat,
        lon: c.lon,
        tags: { ...(d.tags ?? {}) },
        target: d.target!,
      }
      if (d.targetVersion !== undefined) item.targetVersion = d.targetVersion
      if (d.move) item.move = true
      return item
    })
    const regions = [
      ...new Set(g.map((x) => o.regionOf?.(x.sourceId)).filter((r): r is string => !!r)),
    ]
    const area =
      oblast !== undefined ? oblastLabel(oblast) : regions.length === 1 ? regions[0] : undefined
    const creates = items.filter((i) => i.kind === 'create').length
    const tagInput: Parameters<typeof changesetTags>[0] = {
      datasetName: o.info.dataset_name,
      source: '',
      creates,
      modifies: items.length - creates,
      createdBy: CREATED_BY,
      live: o.target === 'live',
    }
    if (area) tagInput.area = area
    const comment = changesetTags(tagInput).comment!
    const batch: BatchRecord = {
      id,
      datasetId: o.datasetId,
      apiTarget: o.target,
      status: 'draft',
      comment,
      createdAt: at,
      sourceIds: items.map((i) => i.sourceId),
      items,
    }
    await db.put('batch', batch)
    await appendEvent(db, {
      at,
      type: 'batch_created',
      datasetId: o.datasetId,
      apiTarget: o.target,
      data: { batchId: id, sourceIds: batch.sourceIds, comment },
    })
    out.push(batch)
  }
  return out
}

export interface RunContext {
  db: DB
  api: OsmApiClient
  account: string
  info: Pick<DatasetInfo, 'dataset_name' | 'source_url' | 'ref_key'>
  /** Live only: stamped into every changeset. */
  wikiUrl?: string
  forumUrl?: string
  now?: () => Date
}

export interface BatchOutcome {
  status: BatchRecord['status']
  step?: BatchRecord['step']
  uploaded: number
  excluded: number
  error?: string
}

const key = (t: string, id: number) => `${t}/${id}`

async function save(ctx: RunContext, b: BatchRecord): Promise<void> {
  await ctx.db.put('batch', b)
}

async function event(
  ctx: RunContext,
  b: BatchRecord,
  type: string,
  data: unknown,
  sourceId?: string,
): Promise<void> {
  const e: Parameters<typeof appendEvent>[1] = {
    at: (ctx.now?.() ?? new Date()).toISOString(),
    type,
    datasetId: b.datasetId,
    apiTarget: b.apiTarget,
    account: ctx.account,
    data,
  }
  if (sourceId !== undefined) e.sourceId = sourceId
  await appendEvent(ctx.db, e)
}

/** Flag a decision as changed upstream: it leaves the batch queue until re-confirmed. */
async function flagUpstream(ctx: RunContext, b: BatchRecord, sourceId: string): Promise<void> {
  const d = await ctx.db.get('decision', [b.datasetId, sourceId])
  if (d) await ctx.db.put('decision', { ...d, superseded: true, supersededBy: 'upstream' })
}

/** Re-fetch current versions, 100 per request per type. Missing elements are absent from the map. */
export async function fetchCurrent(
  api: OsmApiClient,
  targets: readonly { osmType: OsmType; osmId: number }[],
): Promise<Map<string, ApiElement>> {
  const out = new Map<string, ApiElement>()
  for (const type of ['node', 'way', 'relation'] as const) {
    const ids = [...new Set(targets.filter((t) => t.osmType === type).map((t) => t.osmId))]
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      const res = await api.request('GET', `/${type}s.json?${type}s=${chunk.join(',')}`)
      if (res.ok) {
        for (const e of parseApiElements(await res.json())) out.set(key(e.type, e.id), e)
        continue
      }
      if (res.status !== 404)
        throw new ApiError(`re-fetch ${type}s: HTTP ${res.status}`, res.status)
      // One of them does not exist; fall back to one request each so the rest still proceed.
      for (const id of chunk) {
        const one = await api.request('GET', `/${type}/${id}.json`)
        if (one.ok)
          for (const e of parseApiElements(await one.json())) out.set(key(e.type, e.id), e)
      }
    }
  }
  return out
}

export interface PreparedItems {
  upload: UploadItem[]
  excluded: {
    item: BatchItem
    result: NonNullable<BatchItem['result']>
    actual: number | 'deleted' | null
  }[]
}

/**
 * Pure: turn batch items plus freshly fetched elements into upload items,
 * excluding version conflicts, deleted targets and no-op updates. Shared by
 * the real upload and the dry run so both see exactly the same thing.
 */
export function prepareItems(
  items: readonly BatchItem[],
  current: ReadonlyMap<string, ApiElement>,
): PreparedItems {
  const out: PreparedItems = { upload: [], excluded: [] }
  for (const it of items) {
    if (it.kind === 'create') {
      out.upload.push({
        kind: 'create',
        sourceId: it.sourceId,
        placeholderId: it.placeholderId!,
        lat: it.lat,
        lon: it.lon,
        tags: it.tags,
      })
      continue
    }
    const cur = current.get(key(it.target!.osmType, it.target!.osmId))
    if (!cur || cur.visible === false) {
      out.excluded.push({
        item: it,
        result: { status: 'gone', message: 'deleted upstream' },
        actual: 'deleted',
      })
      continue
    }
    if (it.targetVersion !== undefined && cur.version !== it.targetVersion) {
      out.excluded.push({
        item: it,
        result: {
          status: 'conflict',
          message: `expected version ${it.targetVersion}, server has ${cur.version}`,
        },
        actual: cur.version,
      })
      continue
    }
    const moveTo = it.move && cur.type === 'node' ? { lat: it.lat, lon: it.lon } : undefined
    if (isNoopUpdate(cur.tags, it.tags, moveTo !== undefined)) {
      out.excluded.push({
        item: it,
        result: { status: 'noop', message: 'already current' },
        actual: null,
      })
      continue
    }
    const m: UploadItem = { kind: 'modify', sourceId: it.sourceId, current: cur, changes: it.tags }
    if (moveTo) m.moveTo = moveTo
    out.upload.push(m)
  }
  return out
}

/**
 * Dry run: the osmChange a batch would upload right now, without
 * changeset ids, for review in JOSM. Only public reads; nothing is written.
 */
export async function dryRunOsc(
  api: OsmApiClient,
  b: BatchRecord,
): Promise<{ osc: string; excluded: PreparedItems['excluded'] }> {
  const current = await fetchCurrent(
    api,
    b.items.filter((i) => i.kind === 'modify').map((i) => i.target!),
  )
  const p = prepareItems(b.items, current)
  return { osc: buildOsmChange(null, p.upload, CREATED_BY), excluded: p.excluded }
}

const conflictRe = /of (Node|Way|Relation) (\d+)/i

/**
 * Run one draft batch: re-validate, snapshot, open, upload, close. Leaves it
 * `in_flight` at step `verify` on success (read-back verification finishes it).
 */
export async function runBatch(ctx: RunContext, batchId: string): Promise<BatchOutcome> {
  const { db, api } = ctx
  let b = (await db.get('batch', batchId))!
  if (b.status !== 'draft') throw new Error(`batch ${batchId} is ${b.status}, not draft`)
  if (api.target !== b.apiTarget)
    throw new Error(`batch is for ${b.apiTarget}, client is for ${api.target}`)
  // Defence in depth: live changesets must carry the wiki page and forum thread.
  if (b.apiTarget === 'live' && (!ctx.wikiUrl || !ctx.forumUrl)) {
    throw new Error('live uploads require the import wiki page and forum thread URLs')
  }
  if (b.apiTarget === 'live' && !b.dryRunAt) throw new Error('live batches require a dry run first')

  b = { ...b, status: 'in_flight', step: 'revalidate' }
  await save(ctx, b)

  // Step 3: re-validate every update target against the version the reviewer saw.
  const modifies = b.items.filter((i) => i.kind === 'modify')
  const current = await fetchCurrent(
    api,
    modifies.map((i) => i.target!),
  )
  const prepared = prepareItems(b.items, current)
  const upload = prepared.upload
  for (const { item, result, actual } of prepared.excluded) {
    const it = b.items.find((i) => i.sourceId === item.sourceId)!
    it.result = result
    if (result.status === 'noop') continue
    await flagUpstream(ctx, b, it.sourceId)
    await event(
      ctx,
      b,
      'version_conflict',
      { object: key(it.target!.osmType, it.target!.osmId), expected: it.targetVersion, actual },
      it.sourceId,
    )
  }

  // Step 4: snapshot every object about to be modified — without this there is no revert.
  for (const u of upload) {
    if (u.kind !== 'modify') continue
    const c = u.current
    await db.put('snapshot', {
      batchId: b.id,
      osmType: c.type,
      osmId: c.id,
      version: c.version,
      tags: { ...c.tags },
      ...(c.type === 'node' ? { lat: c.lat, lon: c.lon } : {}),
    })
  }

  if (upload.length === 0) {
    b = {
      ...b,
      status: 'failed',
      step: 'done',
      error: 'nothing left to upload after re-validation',
    }
    await save(ctx, b)
    return outcome(b)
  }

  // Step 5: open the changeset.
  const tagInput: Parameters<typeof changesetTags>[0] = {
    datasetName: ctx.info.dataset_name,
    source: ctx.info.source_url,
    creates: upload.filter((u) => u.kind === 'create').length,
    modifies: upload.filter((u) => u.kind === 'modify').length,
    createdBy: CREATED_BY,
    live: b.apiTarget === 'live',
  }
  const area = /\bin (.+):/.exec(b.comment)?.[1]
  if (area) tagInput.area = area
  if (ctx.wikiUrl) tagInput.wikiUrl = ctx.wikiUrl
  if (ctx.forumUrl) tagInput.forumUrl = ctx.forumUrl
  const tags = changesetTags(tagInput)
  b = { ...b, step: 'open', changesetTags: tags }
  await save(ctx, b)
  const changesetId = Number(
    await api.ok('PUT', '/changeset/create', buildChangesetXml(tags, CREATED_BY)),
  )
  b = { ...b, changesetId, step: 'upload' }
  await save(ctx, b)
  await event(ctx, b, 'changeset_opened', { changesetId, tags })

  // Step 6: one osmChange. Atomic on the server: on 409/410 nothing landed, so
  // rebuilding without the offending object is safe (this is not a blind retry).
  let items = upload
  for (;;) {
    const osc = buildOsmChange(changesetId, items, CREATED_BY)
    b = { ...b, osc }
    await save(ctx, b) // persisted before sending
    let res: Response
    try {
      res = await api.request('POST', `/changeset/${changesetId}/upload`, osc)
    } catch (e) {
      // Unknown outcome: stop. Recovery reads the changeset back (step 8).
      b = {
        ...b,
        error: `connection lost during upload: ${e instanceof Error ? e.message : String(e)}. Use Recover.`,
      }
      await save(ctx, b)
      await event(ctx, b, 'upload_interrupted', { changesetId })
      return outcome(b)
    }
    const text = await res.text()
    if (res.ok) {
      await applyDiff(ctx, b, items, text)
      break
    }
    const m = conflictRe.exec(text)
    if ((res.status === 409 || res.status === 410) && m) {
      const bad = key(m[1]!.toLowerCase(), Number(m[2]))
      const hit = items.find(
        (u) => u.kind !== 'create' && key(u.current.type, u.current.id) === bad,
      )
      if (hit) {
        const it = b.items.find((i) => i.sourceId === hit.sourceId)!
        it.result = {
          status: res.status === 410 ? 'gone' : 'conflict',
          message: text.slice(0, 200),
        }
        await flagUpstream(ctx, b, it.sourceId)
        await event(
          ctx,
          b,
          'version_conflict',
          { object: bad, server: text.slice(0, 200) },
          it.sourceId,
        )
        items = items.filter((u) => u !== hit)
        if (items.length > 0) continue
      }
    }
    // Rejected as a whole: nothing landed. Close the changeset and stop.
    b = {
      ...b,
      status: 'failed',
      step: 'close',
      error: `upload rejected: HTTP ${res.status} ${text.slice(0, 300)}`,
    }
    await save(ctx, b)
    await event(ctx, b, 'upload_rejected', {
      changesetId,
      status: res.status,
      body: text.slice(0, 500),
    })
    await closeChangeset(ctx, b)
    b = { ...(await db.get('batch', b.id))!, step: 'done' }
    await save(ctx, b)
    return outcome(b)
  }

  // Step 7: close.
  b = (await db.get('batch', b.id))!
  await closeChangeset(ctx, b)
  return outcome((await db.get('batch', b.id))!)
}

async function closeChangeset(ctx: RunContext, b: BatchRecord): Promise<void> {
  try {
    await ctx.api.ok('PUT', `/changeset/${b.changesetId}/close`)
  } catch (e) {
    // Already closed (e.g. by the server's timeout) is fine; anything else keeps step 'close' for Recover.
    if (!(e instanceof ApiError && e.status === 409)) {
      await save(ctx, {
        ...b,
        error: `could not close changeset ${b.changesetId}: ${String(e)}. Use Recover.`,
      })
      return
    }
  }
  await event(ctx, b, 'changeset_closed', { changesetId: b.changesetId, tags: b.changesetTags })
  const after = (await ctx.db.get('batch', b.id))!
  if (after.status === 'in_flight' && after.step === 'close')
    await save(ctx, { ...after, step: 'verify' })
}

/** One item reached the server: result, durable link, decision marked uploaded, audit event. */
async function recordLanded(
  ctx: RunContext,
  b: BatchRecord,
  it: BatchItem,
  osmType: OsmType,
  osmId: number,
  version: number,
): Promise<void> {
  it.result = { status: 'ok', osmType, osmId, version }
  await ctx.db.put('link', {
    datasetId: b.datasetId,
    sourceId: it.sourceId,
    apiTarget: b.apiTarget,
    osmType,
    osmId,
  })
  const dec = await ctx.db.get('decision', [b.datasetId, it.sourceId])
  if (dec) await ctx.db.put('decision', { ...dec, uploadedBatchId: b.id })
  await event(
    ctx,
    b,
    'upload_item_result',
    { intended: it.kind, osmType, osmId, version },
    it.sourceId,
  )
}

/** Record results from a diffResult. */
async function applyDiff(
  ctx: RunContext,
  b: BatchRecord,
  sent: readonly UploadItem[],
  diffXml: string,
): Promise<void> {
  const byOld = new Map(parseDiffResult(diffXml).map((d) => [key(d.type, d.oldId), d]))
  for (const u of sent) {
    const it = b.items.find((i) => i.sourceId === u.sourceId)!
    const d =
      u.kind === 'create'
        ? byOld.get(key('node', u.placeholderId))
        : byOld.get(key(u.current.type, u.current.id))
    if (!d || d.newId === undefined || d.newVersion === undefined) {
      it.result = { status: 'conflict', message: 'missing from diffResult' }
      continue
    }
    await recordLanded(ctx, b, it, d.type, d.newId, d.newVersion)
  }
  await save(ctx, { ...b, step: 'close', error: undefined })
}

function outcome(b: BatchRecord): BatchOutcome {
  const o: BatchOutcome = {
    status: b.status,
    uploaded: b.items.filter((i) => i.result?.status === 'ok').length,
    excluded: b.items.filter((i) => i.result && i.result.status !== 'ok').length,
  }
  if (b.step) o.step = b.step
  if (b.error) o.error = b.error
  return o
}

/**
 * Explicit recovery of an in-flight batch: read the changeset
 * back from the server and reconcile what actually landed. Never re-uploads.
 */
export async function recoverBatch(ctx: RunContext, batchId: string): Promise<BatchOutcome> {
  const { db, api } = ctx
  let b = (await db.get('batch', batchId))!
  if (b.status !== 'in_flight') throw new Error(`batch ${batchId} is ${b.status}, not in flight`)
  await event(ctx, b, 'batch_recovery_started', { step: b.step, changesetId: b.changesetId })

  if (b.changesetId === undefined) {
    // Nothing was ever sent: safe to return to draft.
    b = { ...b, status: 'draft', step: undefined, error: undefined }
    for (const it of b.items) delete it.result
    await save(ctx, b)
    return outcome(b)
  }

  const osc = await api.ok('GET', `/changeset/${b.changesetId}/download`)
  const landed = parseDownloadedChange(osc)
  if (landed.length === 0) {
    // The upload never landed (uploads are atomic). Close and mark failed; the decisions stay ready.
    b = {
      ...b,
      status: 'failed',
      step: 'close',
      error: 'recovered: the upload did not reach the server',
    }
    await save(ctx, b)
    await closeChangeset(ctx, b)
    await save(ctx, { ...(await db.get('batch', b.id))!, step: 'done' })
    await event(ctx, b, 'batch_recovered', { landed: 0 })
    return outcome((await db.get('batch', b.id))!)
  }

  // Reconcile item by item. Creates are matched by tags and position.
  let count = 0
  for (const it of b.items) {
    if (it.result && it.result.status !== 'ok') continue
    const hit =
      it.kind === 'create'
        ? landed.find(
            (l) =>
              l.action === 'create' &&
              l.type === 'node' &&
              sameTags(l.tags, it.tags) &&
              Math.abs(l.lat! - it.lat) < 1e-6 &&
              Math.abs(l.lon! - it.lon) < 1e-6,
          )
        : landed.find((l) => l.type === it.target!.osmType && l.id === it.target!.osmId)
    if (!hit) {
      it.result = { status: 'conflict', message: 'not found in the changeset after recovery' }
      continue
    }
    await recordLanded(ctx, b, it, hit.type, hit.id, hit.version)
    count++
  }
  b = { ...b, step: 'close', error: undefined }
  await save(ctx, b)
  await closeChangeset(ctx, b)
  await event(ctx, b, 'batch_recovered', { landed: count })
  return outcome((await db.get('batch', b.id))!)
}

const sameTags = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k])
}

export interface DownloadedElement {
  action: 'create' | 'modify' | 'delete'
  type: OsmType
  id: number
  version: number
  lat?: number
  lon?: number
  tags: Record<string, string>
}

const unxml = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#10;/g, '\n')
    .replace(/&amp;/g, '&')

/** Parse `GET /changeset/{id}/download` (osmChange) into elements. */
export function parseDownloadedChange(xml: string): DownloadedElement[] {
  const out: DownloadedElement[] = []
  for (const sec of xml.matchAll(/<(create|modify|delete)>([\s\S]*?)<\/\1>/g)) {
    for (const el of sec[2]!.matchAll(/<(node|way|relation)\s([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
      const a = Object.fromEntries(
        [...el[2]!.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]),
      )
      const tags = Object.fromEntries(
        [...(el[3] ?? '').matchAll(/<tag k="([^"]*)" v="([^"]*)"\/>/g)].map((m) => [
          unxml(m[1]!),
          unxml(m[2]!),
        ]),
      )
      const d: DownloadedElement = {
        action: sec[1] as DownloadedElement['action'],
        type: el[1] as OsmType,
        id: Number(a.id),
        version: Number(a.version),
        tags,
      }
      if (a.lat !== undefined) d.lat = Number(a.lat)
      if (a.lon !== undefined) d.lon = Number(a.lon)
      out.push(d)
    }
  }
  return out
}

/** Current tags an Update would produce — exported for dry runs and verification. */
export { applyChanges }
