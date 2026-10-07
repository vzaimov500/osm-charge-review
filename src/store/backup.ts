/**
 * Export and import of the complete working state.
 * Browser storage is erasable; this file is the reviewer's safety net.
 */
import { canonicalJson } from '../format/canonical'
import { CREATED_BY } from '../version'
import { sha256Hex } from './datasets'
import type { DB, DecisionRecord, EventRecord, Schema } from './db'

export const STATE_FORMAT = 'osm-charge-review-state'
export const STATE_VERSION = 1

/** Every store, in dependency order. */
export const STORES = [
  'dataset',
  'candidate',
  'osm_object',
  'match',
  'decision',
  'snapshot',
  'batch',
  'link',
  'event',
  'network_log',
  'fetch_meta',
  'setting',
] as const satisfies readonly (keyof Schema)[]
export type StoreName = (typeof STORES)[number]

export type StoreRows = { [K in StoreName]: Schema[K]['value'][] }

export interface StateFile {
  format: typeof STATE_FORMAT
  version: number
  exported_at: string
  tool: string
  /** SHA-256 of canonicalJson(stores). Detects truncated or hand-edited files. */
  checksum: string
  stores: StoreRows
}

export async function exportState(db: DB, now = new Date()): Promise<StateFile> {
  const stores = {} as StoreRows
  for (const name of STORES) (stores as Record<string, unknown[]>)[name] = await db.getAll(name)
  const at = now.toISOString()
  await db.put('setting', { key: 'lastExportAt', value: at })
  return {
    format: STATE_FORMAT,
    version: STATE_VERSION,
    exported_at: at,
    tool: CREATED_BY,
    checksum: await sha256Hex(canonicalJson(stores)),
    stores,
  }
}

export class StateFileError extends Error {
  override name = 'StateFileError'
}

/** Parse and verify a state file. Throws StateFileError with a readable reason. */
export async function readStateFile(text: string): Promise<StateFile> {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new StateFileError('Not a JSON file.')
  }
  const f = data as Partial<StateFile>
  if (f?.format !== STATE_FORMAT) throw new StateFileError('Not an osm-charge-review state export.')
  if (f.version !== STATE_VERSION)
    throw new StateFileError(`State format version ${String(f.version)} is not supported.`)
  if (!f.stores || typeof f.stores !== 'object') throw new StateFileError('The file has no stores.')
  for (const s of STORES) {
    if (!Array.isArray((f.stores as Record<string, unknown>)[s]))
      throw new StateFileError(`Store "${s}" is missing.`)
  }
  if ((await sha256Hex(canonicalJson(f.stores))) !== f.checksum) {
    throw new StateFileError(
      'Checksum mismatch: the file is damaged or was edited. Nothing was imported.',
    )
  }
  return f as StateFile
}

/**
 * merge: the newer decision wins, nothing local is lost.
 * restore: decisions become exactly the file's again (for the datasets in the
 * file), undoing later ones; decisions that record an upload are always kept.
 */
export type ImportMode = 'merge' | 'restore'

export interface ImportPlan {
  mode: ImportMode
  /** Rows written per store. */
  write: Record<StoreName, number>
  /** Merge: decisions where the local copy is newer and is kept. */
  keptLocalDecisions: number
  /** Restore: local decisions replaced by the file's or removed. */
  undoneLocalDecisions: number
  /** Restore: local decisions kept because they record an upload the file does not know. */
  keptUploadedDecisions: number
  /** Events already present locally (skipped). */
  duplicateEvents: number
}

/** Identity of an append-only row, ignoring its local sequence number. */
const eventKey = (e: { seq?: number }): string => {
  const { seq: _s, ...rest } = e
  return canonicalJson(rest)
}

const newer = (a: DecisionRecord, b: DecisionRecord): boolean => a.decidedAt > b.decidedAt

/**
 * Bring a state file into storage. Decisions follow `mode` (see ImportMode).
 * Events and network log are append-only and de-duplicated, so the audit
 * trail keeps everything either way. Everything else is replaced by the
 * file's copy (it is either cache or immutable history); batches the file
 * does not know (uploads after the export) stay.
 *
 * `dryRun` computes the plan without writing.
 */
export async function importState(
  db: DB,
  file: StateFile,
  dryRun = false,
  mode: ImportMode = 'merge',
): Promise<ImportPlan> {
  const plan: ImportPlan = {
    mode,
    write: Object.fromEntries(STORES.map((s) => [s, 0])) as Record<StoreName, number>,
    keptLocalDecisions: 0,
    undoneLocalDecisions: 0,
    keptUploadedDecisions: 0,
    duplicateEvents: 0,
  }
  const tx = db.transaction([...STORES], dryRun ? 'readonly' : 'readwrite')

  // Restore: local decisions of the file's datasets that the file does not have are undone,
  // unless they record an upload (that happened in OSM; restoring cannot take it back).
  if (mode === 'restore') {
    const datasets = new Set(file.stores.decision.map((d) => d.datasetId))
    for (const r of file.stores.dataset) datasets.add(r.datasetId)
    const inFile = new Set(file.stores.decision.map((d) => `${d.datasetId}\u0000${d.sourceId}`))
    const decisions = tx.objectStore('decision')
    for (const local of await decisions.getAll()) {
      if (!datasets.has(local.datasetId) || inFile.has(`${local.datasetId}\u0000${local.sourceId}`))
        continue
      if (local.uploadedBatchId) {
        plan.keptUploadedDecisions++
        continue
      }
      plan.undoneLocalDecisions++
      if (!dryRun)
        await (decisions as unknown as { delete(k: [string, string]): Promise<void> }).delete([
          local.datasetId,
          local.sourceId,
        ])
    }
  }

  const localEvents = new Set((await tx.objectStore('event').getAll()).map(eventKey))
  const localLog = new Set((await tx.objectStore('network_log').getAll()).map(eventKey))

  for (const name of STORES) {
    const store = tx.objectStore(name)
    for (const row of file.stores[name] as unknown[]) {
      if (name === 'event' || name === 'network_log') {
        const key = eventKey(row as { seq?: number })
        const seen = name === 'event' ? localEvents : localLog
        if (seen.has(key)) {
          if (name === 'event') plan.duplicateEvents++
          continue
        }
        seen.add(key)
        const { seq: _seq, ...rest } = row as EventRecord
        if (!dryRun) await (store as unknown as { add(v: unknown): Promise<unknown> }).add(rest)
        plan.write[name]++
        continue
      }
      if (name === 'decision') {
        const d = row as DecisionRecord
        const local = await tx.objectStore('decision').get([d.datasetId, d.sourceId])
        const same = local !== undefined && canonicalJson(local) === canonicalJson(d)
        if (mode === 'merge' && local && !newer(d, local)) {
          if (!same) plan.keptLocalDecisions++
          continue
        }
        if (mode === 'restore' && local && !same) {
          if (local.uploadedBatchId && local.uploadedBatchId !== d.uploadedBatchId) {
            plan.keptUploadedDecisions++
            continue
          }
          plan.undoneLocalDecisions++
        }
      }
      if (name === 'setting' && (row as { key: string }).key === 'lastExportAt') continue
      if (!dryRun) await (store as unknown as { put(v: unknown): Promise<unknown> }).put(row)
      plan.write[name]++
    }
  }
  await tx.done
  return plan
}

/** When the state was last exported, and whether decisions were made since. */
export async function exportStatus(
  db: DB,
): Promise<{ lastExportAt?: string; decisionsSince: number }> {
  const last = (await db.get('setting', 'lastExportAt'))?.value as string | undefined
  // Count by timestamp, not by sequence: imported events get new sequence
  // numbers but keep their original times.
  const decisionsSince = (await db.getAll('event')).filter(
    (e) => e.type.startsWith('decision_') && (last === undefined || e.at > last),
  ).length
  return last === undefined ? { decisionsSince } : { lastExportAt: last, decisionsSince }
}
