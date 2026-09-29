/**
 * What an Update writes. Additive by construction: a change set only ever
 * sets keys; nothing here can delete a tag (`only_in_osm` keys are
 * never deleted).
 */
import type { Divergence, TagDivergence } from '../match'

/** key → whether the reviewer applies the candidate's value. */
export type KeySelection = Readonly<Record<string, boolean>>

/** The keys an Update could change: everything missing in OSM or different. */
export function changeableKeys(div: Divergence): TagDivergence[] {
  return div.tags.filter((t) => t.state === 'missing_in_osm' || t.state === 'differs')
}

/**
 * Default ticks: additions and non-conflicting corrections are on; conflicts
 * (surveyed keys, socket variants) are off and need an explicit tick.
 */
export function defaultSelection(div: Divergence): Record<string, boolean> {
  const conflicts = new Set(div.conflicts)
  const out: Record<string, boolean> = {}
  for (const t of changeableKeys(div)) out[t.key] = !conflicts.has(t.key)
  return out
}

/** The tag changes to write for an Update, given the reviewer's ticks. */
export function changesFor(div: Divergence, selection: KeySelection): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of changeableKeys(div)) if (selection[t.key] === true) out[t.key] = t.candidate!
  return out
}

/** Apply a change set on top of an object's current tags. Never removes a key. */
export function applyChanges(
  current: Readonly<Record<string, string>>,
  changes: Readonly<Record<string, string>>,
): Record<string, string> {
  return { ...current, ...changes }
}

/** An Update that changes nothing must never reach a changeset. */
export function isNoopUpdate(
  current: Readonly<Record<string, string>>,
  changes: Readonly<Record<string, string>>,
  move: boolean,
): boolean {
  return !move && Object.entries(changes).every(([k, v]) => current[k] === v)
}
