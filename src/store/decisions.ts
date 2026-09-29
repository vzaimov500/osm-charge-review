import type { Decision } from '../review'
import { appendEvent, type DB, type DecisionRecord } from './db'

export function toRecord(datasetId: string, sourceId: string, d: Decision): DecisionRecord {
  const r: DecisionRecord = {
    datasetId,
    sourceId,
    action: d.action,
    decidedAt: d.decidedAt,
    contentHash: d.contentHash,
    superseded: d.superseded,
  }
  if (d.target) {
    r.targetOsmType = d.target.osmType
    r.targetOsmId = d.target.osmId
  }
  if (d.targetVersion !== undefined) r.targetVersion = d.targetVersion
  if (d.tags) r.tags = d.tags
  if (d.move) r.move = true
  if (d.reasonCode) r.reasonCode = d.reasonCode
  if (d.note) r.note = d.note
  if (d.supersededBy) r.supersededBy = d.supersededBy
  if (d.uploadedBatchId) r.uploadedBatchId = d.uploadedBatchId
  return r
}

export function fromRecord(r: DecisionRecord): Decision {
  const d: Decision = {
    action: r.action,
    decidedAt: r.decidedAt,
    contentHash: r.contentHash,
    superseded: r.superseded,
  }
  if (r.targetOsmType !== undefined && r.targetOsmId !== undefined)
    d.target = { osmType: r.targetOsmType, osmId: r.targetOsmId }
  if (r.targetVersion !== undefined) d.targetVersion = r.targetVersion
  if (r.tags) d.tags = r.tags
  if (r.move) d.move = true
  if (r.reasonCode) d.reasonCode = r.reasonCode as Decision['reasonCode']
  if (r.note) d.note = r.note
  if (r.supersededBy) d.supersededBy = r.supersededBy
  if (r.uploadedBatchId) d.uploadedBatchId = r.uploadedBatchId
  return d
}

/** Record a decision; the audit trail keeps old and new values. */
export async function saveDecision(
  db: DB,
  datasetId: string,
  sourceId: string,
  d: Decision,
): Promise<void> {
  const prev = await db.get('decision', [datasetId, sourceId])
  const rec = toRecord(datasetId, sourceId, d)
  await db.put('decision', rec)
  await appendEvent(db, {
    at: d.decidedAt,
    type: prev ? 'decision_changed' : 'decision_set',
    datasetId,
    sourceId,
    data: prev ? { old: prev, new: rec } : { new: rec },
  })
}

/** Remove a decision (the row returns to undecided). Audited. */
export async function clearDecision(
  db: DB,
  datasetId: string,
  sourceId: string,
  at: string,
): Promise<void> {
  const prev = await db.get('decision', [datasetId, sourceId])
  if (!prev) return
  await db.delete('decision', [datasetId, sourceId])
  await appendEvent(db, { at, type: 'decision_cleared', datasetId, sourceId, data: { old: prev } })
}

export async function loadDecisions(db: DB, datasetId: string): Promise<Map<string, Decision>> {
  const rows = await db.getAllFromIndex('decision', 'datasetId', datasetId)
  return new Map(rows.map((r) => [r.sourceId, fromRecord(r)]))
}
