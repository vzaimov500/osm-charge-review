/**
 * Read-back verification and revert, against a live API client.
 */
import { buildChangesetXml, buildOsmChange } from '../osm/build/osmChange'
import { planRevert, verifyItem, type RevertPlan, type VerifyResult } from '../osm/build/verify'
import { ApiError } from '../osm/transport/api'
import { fetchCurrent, type RunContext } from '../osm/upload'
import { appendEvent, type BatchRecord, type SnapshotRecord } from '../store/db'
import { CREATED_BY } from '../version'

const uploaded = (b: BatchRecord) => b.items.filter((i) => i.result?.status === 'ok')

async function snapshotsOf(ctx: RunContext, batchId: string): Promise<Map<string, SnapshotRecord>> {
  const rows = await ctx.db.getAllFromIndex('snapshot', 'batchId', batchId)
  return new Map(rows.map((s) => [`${s.osmType}/${s.osmId}`, s]))
}

async function event(
  ctx: RunContext,
  b: BatchRecord,
  type: string,
  data: unknown,
  sourceId?: string,
) {
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

/**
 * Re-fetch every object the batch wrote and compare with intent. A batch is
 * `verified` only when every object matches; otherwise it stays in flight and
 * the differences are recorded loudly.
 */
export async function verifyBatch(ctx: RunContext, batchId: string): Promise<VerifyResult[]> {
  let b = (await ctx.db.get('batch', batchId))!
  if (b.status !== 'in_flight' && b.status !== 'verified')
    throw new Error(`batch ${batchId} is ${b.status}; nothing to verify`)
  const items = uploaded(b)
  const current = await fetchCurrent(
    ctx.api,
    items.map((i) => ({ osmType: i.result!.osmType!, osmId: i.result!.osmId! })),
  )
  const snaps = await snapshotsOf(ctx, b.id)
  const results = items.map((i) =>
    verifyItem(
      i,
      current.get(`${i.result!.osmType}/${i.result!.osmId}`),
      snaps.get(`${i.result!.osmType}/${i.result!.osmId}`),
    ),
  )
  for (const r of results) await event(ctx, b, 'verify_result', r, r.sourceId)

  const bad = results.filter((r) => r.state !== 'match')
  if (b.status === 'in_flight') {
    b =
      bad.length === 0 && (b.step === 'verify' || b.step === 'done')
        ? { ...b, status: 'verified', step: 'done', error: undefined }
        : {
            ...b,
            error: bad.length
              ? `verification: ${bad.length} of ${results.length} objects do not match — see the audit log`
              : b.error,
          }
    await ctx.db.put('batch', b)
  }
  return results
}

export interface RevertOutcome {
  plan: RevertPlan
  changesetId?: number
}

/**
 * Revert a batch in its own changeset: restore snapshot tags,
 * delete created objects — only where nobody else has edited since. Objects
 * touched by others are returned for manual handling, never overwritten.
 */
export async function revertBatch(
  ctx: RunContext,
  batchId: string,
  dryRun = false,
): Promise<RevertOutcome> {
  const b = (await ctx.db.get('batch', batchId))!
  if (b.status !== 'verified' && !(b.status === 'in_flight' && b.step === 'verify')) {
    throw new Error(`batch ${batchId} is ${b.status}; only uploaded batches can be reverted`)
  }
  if (ctx.api.target !== b.apiTarget)
    throw new Error(`batch is for ${b.apiTarget}, client is for ${ctx.api.target}`)
  const items = uploaded(b)
  const current = await fetchCurrent(
    ctx.api,
    items.map((i) => ({ osmType: i.result!.osmType!, osmId: i.result!.osmId! })),
  )
  const plan = planRevert(items, current, await snapshotsOf(ctx, b.id))
  if (dryRun || plan.items.length === 0) {
    if (!dryRun) await event(ctx, b, 'revert_nothing_to_do', { manual: plan.manual })
    return { plan }
  }

  const tags: Record<string, string> = {
    comment: `Revert of changeset ${b.changesetId ?? '?'} (${b.comment})`.slice(0, 255),
    created_by: CREATED_BY,
  }
  const changesetId = Number(
    await ctx.api.ok('PUT', '/changeset/create', buildChangesetXml(tags, CREATED_BY)),
  )
  await ctx.db.put('batch', { ...b, error: `revert in progress in changeset ${changesetId}` })
  await event(ctx, b, 'changeset_opened', { changesetId, tags, revertOf: b.changesetId })
  let uploadError: unknown
  try {
    await ctx.api.ok(
      'POST',
      `/changeset/${changesetId}/upload`,
      buildOsmChange(changesetId, plan.items, CREATED_BY),
    )
  } catch (e) {
    uploadError = e
  }
  // Always close the changeset; an upload error takes precedence over a close error.
  try {
    await ctx.api.ok('PUT', `/changeset/${changesetId}/close`)
    await event(ctx, b, 'changeset_closed', { changesetId })
  } catch (e) {
    if (!uploadError && !(e instanceof ApiError && e.status === 409)) throw e
  }
  if (uploadError) {
    await ctx.db.put('batch', {
      ...b,
      error: `revert failed in changeset ${changesetId}: ${String(uploadError)}`,
    })
    throw uploadError
  }
  await ctx.db.put('batch', {
    ...b,
    status: 'reverted',
    step: 'done',
    error: plan.manual.length
      ? `reverted in changeset ${changesetId}; ${plan.manual.length} objects need manual handling`
      : undefined,
  })
  // Reverted decisions become ready again only if the operator re-decides; clear the upload marks.
  for (const it of plan.items) {
    const d = await ctx.db.get('decision', [b.datasetId, it.sourceId])
    if (d) {
      const { uploadedBatchId: _u, ...rest } = d
      await ctx.db.put('decision', { ...rest, superseded: true, supersededBy: 'upstream' })
    }
  }
  await event(ctx, b, 'batch_reverted', {
    changesetId,
    reverted: plan.items.map((i) => i.sourceId),
    manual: plan.manual,
  })
  return { plan, changesetId }
}
