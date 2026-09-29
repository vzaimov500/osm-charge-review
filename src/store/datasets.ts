import type { ParsedDataset } from '../format'
import { appendEvent, type CandidateRecord, type DB } from './db'

export interface ImportSummary {
  datasetId: string
  total: number
  added: number
  changed: number
  unchanged: number
  /** In storage but absent from this file: listed as "worth surveying", never deleted. */
  disappeared: number
  /** Decisions invalidated because their candidate changed. */
  superseded: number
}

/** SHA-256 of the file text, hex. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Store a validated dataset. Re-importing the same dataset_id updates it:
 * changed candidates supersede their decisions (excluded from batches until
 * re-confirmed), vanished candidates are marked `disappeared`.
 */
export async function importDataset(
  db: DB,
  parsed: ParsedDataset,
  fileText: string,
  now = new Date(),
): Promise<ImportSummary> {
  const datasetId = parsed.info.dataset_id
  const at = now.toISOString()
  const fileHash = await sha256Hex(fileText)

  const tx = db.transaction(['dataset', 'candidate', 'decision', 'event'], 'readwrite')
  const candidates = tx.objectStore('candidate')
  const decisions = tx.objectStore('decision')
  const existing = new Map(
    (await candidates.index('datasetId').getAll(datasetId)).map((c) => [c.sourceId, c]),
  )

  const s: ImportSummary = {
    datasetId,
    total: parsed.candidates.length,
    added: 0,
    changed: 0,
    unchanged: 0,
    disappeared: 0,
    superseded: 0,
  }
  const events: Parameters<typeof appendEvent>[1][] = []

  for (const c of parsed.candidates) {
    const prev = existing.get(c.sourceId)
    existing.delete(c.sourceId)
    const rec: CandidateRecord = {
      ...c,
      datasetId,
      firstSeen: prev?.firstSeen ?? at,
      lastSeen: at,
      disappeared: false,
    }
    await candidates.put(rec)
    if (!prev) {
      s.added++
      continue
    }
    if (prev.contentHash === c.contentHash) {
      s.unchanged++
      continue
    }
    s.changed++
    const d = await decisions.get([datasetId, c.sourceId])
    if (d && !d.superseded && d.contentHash !== c.contentHash) {
      await decisions.put({ ...d, superseded: true, supersededBy: 'source' })
      s.superseded++
      events.push({
        at,
        type: 'decision_superseded',
        datasetId,
        sourceId: c.sourceId,
        data: { was: d.contentHash, now: c.contentHash },
      })
    }
  }
  for (const gone of existing.values()) {
    if (!gone.disappeared) await candidates.put({ ...gone, disappeared: true })
    s.disappeared++
  }

  const info = parsed.info
  await tx.objectStore('dataset').put({ datasetId, info, importedAt: at, fileHash })
  events.push({
    at,
    type: 'dataset_imported',
    datasetId,
    data: {
      fileHash,
      adapter: info.adapter,
      retrievedAt: info.retrieved_at,
      licence: info.licence,
      ...s,
    },
  })
  for (const e of events) await tx.objectStore('event').add(e)
  await tx.done
  return s
}

export async function listDatasets(db: DB) {
  return db.getAll('dataset')
}

/** Current (not disappeared) candidates of a dataset. */
export async function loadCandidates(db: DB, datasetId: string): Promise<CandidateRecord[]> {
  return (await db.getAllFromIndex('candidate', 'datasetId', datasetId)).filter(
    (c) => !c.disappeared,
  )
}

/** Candidates that vanished from the feed: a survey list, never deletions. */
export async function loadDisappeared(db: DB, datasetId: string): Promise<CandidateRecord[]> {
  return (await db.getAllFromIndex('candidate', 'datasetId', datasetId)).filter(
    (c) => c.disappeared,
  )
}
