import type { MatchClass } from '../match'
import type { Action, RowModel, RowWarning } from './rows'

/**
 * A row's state as four fixed-width letters, read like `ls -l`: match,
 * decision, batch, attention. `-` always means "nothing (yet)".
 */
export interface StatusCode {
  match: string
  decision: string
  batch: string
  attention: string
}

/** Where a row's decision is in the upload pipeline of the current environment. */
export type BatchState = 'planned' | 'uploaded' | 'verified'

export const MATCH_CHAR: Record<MatchClass, string> = {
  linked: 'L',
  probable: 'P',
  possible: '?',
  none: 'N',
  lifecycle: 'X',
}
export const DECISION_CHAR: Record<Action, string> = {
  add: 'A',
  update: 'U',
  reject: 'R',
  skip: 'S',
}
export const BATCH_CHAR: Record<BatchState, string> = { planned: 'b', uploaded: 'u', verified: 'v' }

/**
 * Warnings that are information rather than a call to act: nearly every
 * station an active local mapper looks after has one, so they would drown
 * the `!` column. The detail view still shows them.
 */
const INFORMATIONAL: readonly RowWarning[] = ['recent_human_edit', 'recent_survey']

export function statusCode(row: RowModel, batch?: BatchState): StatusCode {
  const needsLook = row.warnings.some((w) => !INFORMATIONAL.includes(w))
  return {
    match: MATCH_CHAR[row.match.class],
    decision: row.decision ? DECISION_CHAR[row.decision.action] : '-',
    batch: batch ? BATCH_CHAR[batch] : '-',
    attention: row.warnings.includes('superseded') ? '*' : needsLook ? '!' : '-',
  }
}

/** Batch statuses → the row-level state shown in the list. Failed and reverted batches show nothing. */
export function batchStateOf(status: string): BatchState | undefined {
  if (status === 'draft') return 'planned'
  if (status === 'in_flight') return 'uploaded'
  if (status === 'verified') return 'verified'
  return undefined
}

/**
 * The next (dir 1) or previous (dir -1) undecided row from `from`, not
 * including `from` itself; undefined when there is none in that direction.
 */
export function nextUndecided(
  rows: readonly RowModel[],
  from: number,
  dir: 1 | -1 = 1,
): number | undefined {
  for (let i = from + dir; i >= 0 && i < rows.length; i += dir) if (!rows[i]!.decided) return i
  return undefined
}
