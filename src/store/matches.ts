import type { CandidateMatch, MatchConfig } from '../match'
import { classCounts } from '../match'
import { appendEvent, type DB } from './db'

/** Replace a dataset's stored matches and record the run (`match`, `match_run`). */
export async function saveMatchRun(
  db: DB,
  datasetId: string,
  matches: readonly CandidateMatch[],
  cfg: MatchConfig,
  at: string,
): Promise<void> {
  const tx = db.transaction(['match', 'event'], 'readwrite')
  const store = tx.objectStore('match')
  for (const k of await store.index('datasetId').getAllKeys(datasetId)) await store.delete(k)
  for (const m of matches) {
    for (const p of m.pairs) {
      await store.put({
        datasetId,
        sourceId: m.sourceId,
        osmType: p.osmType,
        osmId: p.osmId,
        distanceM: p.distanceM,
        class: p.pairClass,
        reasons: p.reasons,
      })
    }
  }
  await tx.objectStore('event').add({
    at,
    type: 'match_run',
    datasetId,
    data: { counts: classCounts(matches), params: cfg },
  })
  await tx.done
}

export { appendEvent }
