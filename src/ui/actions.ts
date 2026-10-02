import {
  changesFor,
  defaultSelection,
  POSITION_FIXME,
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

const targetKey = (tv: TargetView): string => `${tv.object.osmType}/${tv.object.osmId}`

/** The object picked in the detail view for this row, if it is still nearby. */
export function pickedTarget(app: AppState, row: RowModel): TargetView | undefined {
  const p = app.pickedTarget
  if (!p || p.sourceId !== row.candidate.sourceId) return undefined
  return row.targets.find((tv) => targetKey(tv) === p.key)
}

/** What the detail view shows and what Update (button or key) uses. */
export function shownTarget(app: AppState, row: RowModel): TargetView | undefined {
  return (
    pickedTarget(app, row) ??
    (row.decision?.action === 'update' ? chosenTarget(row) : undefined) ??
    row.suggested
  )
}

/**
 * Pick the object to update. One that needs changes becomes the Update
 * decision; one that is already correct leaves nothing to update, so an
 * Update on another object is withdrawn instead of silently staying.
 */
export async function pickTarget(app: AppState, row: RowModel, tv: TargetView): Promise<string[]> {
  app.pickedTarget = { sourceId: row.candidate.sourceId, key: targetKey(tv) }
  const problems = await update(app, row, tv)
  if (problems.length === 1 && problems[0] === 'update_changes_nothing') {
    if (row.decision?.action === 'update') await app.decide(row, null)
    return []
  }
  return problems
}

/** What an Add would use beyond the candidate's own tags and position. */
export interface AddOptions {
  /** Where the reviewer dragged the station; undefined: the provider position. */
  position?: { lat: number; lon: number }
  /** Tag it as not verified. */
  fixme: boolean
}

/** From the saved Add, else from what was set before choosing Add. */
export function addOptions(app: AppState, row: RowModel): AddOptions {
  const d = row.decision
  if (d?.action === 'add') {
    const o: AddOptions = { fixme: d.tags?.fixme === POSITION_FIXME }
    if (d.position) o.position = d.position
    return o
  }
  const draft = app.addDraft
  if (draft && draft.sourceId === row.candidate.sourceId) {
    const o: AddOptions = { fixme: draft.fixme }
    if (draft.position) o.position = draft.position
    return o
  }
  return { fixme: false }
}

export function add(
  app: AppState,
  row: RowModel,
  opts: AddOptions = addOptions(app, row),
): Promise<string[]> {
  const tags = { ...row.candidate.tags }
  if (opts.fixme) tags.fixme = POSITION_FIXME
  const d: Draft = { action: 'add', tags }
  if (opts.position) d.position = opts.position
  return app.decide(row, withNote(d, row.decision?.note))
}

/**
 * Change where a new station goes or whether it is flagged. A saved Add is
 * re-saved; before Add is chosen the choice waits and Add picks it up.
 */
export function setAddOptions(
  app: AppState,
  row: RowModel,
  change: { position?: { lat: number; lon: number } | null; fixme?: boolean },
): Promise<string[]> {
  const cur = addOptions(app, row)
  const next: AddOptions = { fixme: change.fixme ?? cur.fixme }
  const position = change.position === undefined ? cur.position : change.position
  if (position) next.position = position
  if (row.decision?.action === 'add') return add(app, row, next)
  app.addDraft = { sourceId: row.candidate.sourceId, ...next }
  return Promise.resolve([])
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
