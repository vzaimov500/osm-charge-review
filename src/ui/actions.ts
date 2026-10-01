import {
  changesFor,
  defaultSelection,
  type Decision,
  type RejectReason,
  type RowModel,
  type TargetView,
} from '../review'
import type { AppState } from './state.svelte'

type Draft = Omit<Decision, 'decidedAt' | 'contentHash' | 'superseded'>

const withNote = (d: Draft, note: string | undefined): Draft => (note ? { ...d, note } : d)

export function chosenTarget(row: RowModel): TargetView | undefined {
  const t = row.decision?.target
  if (t)
    return row.targets.find((x) => x.object.osmType === t.osmType && x.object.osmId === t.osmId)
  return undefined
}

/** The target an Update would use: the chosen one, else the suggestion, else the nearest. */
export function updateTarget(row: RowModel): TargetView | undefined {
  return chosenTarget(row) ?? row.suggested ?? row.targets[0]
}

export function add(app: AppState, row: RowModel): Promise<string[]> {
  return app.decide(
    row,
    withNote({ action: 'add', tags: { ...row.candidate.tags } }, row.decision?.note),
  )
}

export function update(
  app: AppState,
  row: RowModel,
  target = updateTarget(row),
  selection?: Record<string, boolean>,
  move?: boolean,
): Promise<string[]> {
  if (!target) return Promise.resolve(['update_without_target'])
  const sel = selection ?? defaultSelection(target.divergence)
  const d: Draft = {
    action: 'update',
    target: { osmType: target.object.osmType, osmId: target.object.osmId },
    targetVersion: target.object.version,
    tags: changesFor(target.divergence, sel),
  }
  if (move) d.move = true
  return app.decide(row, withNote(d, row.decision?.note))
}

export function reject(app: AppState, row: RowModel, reasonCode: RejectReason): Promise<string[]> {
  return app.decide(row, withNote({ action: 'reject', reasonCode }, row.decision?.note))
}

export function skip(app: AppState, row: RowModel): Promise<string[]> {
  return app.decide(row, withNote({ action: 'skip' }, row.decision?.note))
}

/** Re-save the current decision with a new note (or keep the note for later if undecided). */
export function setNote(app: AppState, row: RowModel, note: string): Promise<string[]> {
  const d = row.decision
  if (!d) return Promise.resolve([])
  const { decidedAt: _a, contentHash: _h, superseded: _s, note: _n, ...rest } = d
  return app.decide(row, note ? { ...rest, note } : rest)
}

/** Re-confirm a superseded decision against the current candidate. */
export function reconfirm(app: AppState, row: RowModel): Promise<string[]> {
  const d = row.decision
  if (!d) return Promise.resolve([])
  if (d.action === 'update') {
    const target = chosenTarget(row)
    const sel = Object.fromEntries(Object.keys(d.tags ?? {}).map((k) => [k, true]))
    return update(
      app,
      row,
      target,
      target ? { ...defaultSelection(target.divergence), ...sel } : undefined,
      d.move,
    )
  }
  if (d.action === 'add') return add(app, row)
  const { decidedAt: _a, contentHash: _h, superseded: _s, ...rest } = d
  return app.decide(row, rest)
}
