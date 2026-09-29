import { MATCH_CLASSES, type MatchClass } from '../match'
import { ACTIONS, type Action, type RowModel } from './rows'

export interface Stats {
  total: number
  byClass: Record<MatchClass, number>
  byAction: Record<Action | 'undecided', number>
  /** Rows with a suggested linked/probable target, split. */
  matched: { updateNeeded: number; noop: number }
  superseded: number
  withWarnings: number
}

/** Check before and after every batch. Pure. */
export function computeStats(rows: readonly RowModel[]): Stats {
  const byClass = Object.fromEntries(MATCH_CLASSES.map((c) => [c, 0])) as Record<MatchClass, number>
  const byAction = Object.fromEntries(
    [...ACTIONS, 'undecided'].map((a) => [a, 0]),
  ) as Stats['byAction']
  const s: Stats = {
    total: rows.length,
    byClass,
    byAction,
    matched: { updateNeeded: 0, noop: 0 },
    superseded: 0,
    withWarnings: 0,
  }
  for (const r of rows) {
    byClass[r.match.class]++
    byAction[r.decided ? r.decision!.action : 'undecided']++
    if (r.suggested) {
      if (r.noop) s.matched.noop++
      else s.matched.updateNeeded++
    }
    if (r.decision?.superseded) s.superseded++
    if (r.warnings.length > 0) s.withWarnings++
  }
  return s
}
