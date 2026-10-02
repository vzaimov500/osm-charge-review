import type { Candidate } from '../format'
import {
  divergence,
  humanFlags,
  MATCH_CLASSES,
  type CandidateMatch,
  type Divergence,
  type HumanFlag,
  type MatchConfig,
  type MatchPair,
} from '../match'
import { osmKey, type OsmObject } from '../osm/types'

export type Action = 'add' | 'update' | 'reject' | 'skip'
export const ACTIONS: readonly Action[] = ['add', 'update', 'reject', 'skip']
export const REJECT_REASONS = [
  'in_water',
  'duplicate',
  'closed',
  'bad_coordinates',
  'not_a_station',
  'other',
] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

/** The reviewer's decision as the review layer sees it (persisted as DecisionRecord). */
export interface Decision {
  action: Action
  target?: { osmType: OsmObject['osmType']; osmId: number }
  /** Update: the target's version the reviewer saw. A different version at upload aborts the item. */
  targetVersion?: number
  /** Update: keys to set (additive). Add: the full tags to create. */
  tags?: Record<string, string>
  /** Update: move the object to the candidate position (explicit, never default). */
  move?: boolean
  reasonCode?: RejectReason
  note?: string
  decidedAt: string
  contentHash: string
  superseded: boolean
  supersededBy?: 'source' | 'upstream'
  uploadedBatchId?: string
}

export interface TargetView {
  pair: MatchPair
  object: OsmObject
  divergence: Divergence
  humanFlags: HumanFlag[]
  doNotTouch: boolean
}

export type RowWarning =
  | 'not_operational'
  | 'adapter_notes'
  | 'recent_human_edit'
  | 'recent_survey'
  | 'lifecycle_nearby'
  | 'other_ref_nearby'
  | 'do_not_touch'
  | 'multiple_candidates'
  | 'conflicts'
  | 'moved'
  | 'superseded'

export interface RowModel {
  candidate: Candidate
  match: CandidateMatch
  /** Objects that may be chosen as Update target (never `other_ref`), nearest first. */
  targets: TargetView[]
  /** Suggestion only — linked, else probable. The reviewer decides. */
  suggested?: TargetView
  nearestM?: number
  /** Relative to the suggested target; undefined without one. */
  updateNeeded?: boolean
  /** A suggested linked/probable target where nothing needs to change. */
  noop: boolean
  warnings: RowWarning[]
  decision?: Decision
  decided: boolean
}

export interface RowContext {
  objectsByKey: ReadonlyMap<string, OsmObject>
  cfg: MatchConfig
  now: number
}

const rank = (p: MatchPair) => MATCH_CLASSES.indexOf(p.pairClass)

/** Build the view-model for one candidate. Pure. */
export function buildRow(
  candidate: Candidate,
  match: CandidateMatch,
  decision: Decision | undefined,
  ctx: RowContext,
): RowModel {
  const targets: TargetView[] = []
  const warnings = new Set<RowWarning>()

  for (const pair of match.pairs) {
    if (pair.reasons.includes('other_ref')) {
      warnings.add('other_ref_nearby')
      continue
    }
    const object = ctx.objectsByKey.get(osmKey(pair))
    if (!object) continue
    const flags = humanFlags(object, ctx.cfg, ctx.now)
    if (pair.reasons.includes('lifecycle')) warnings.add('lifecycle_nearby')
    targets.push({
      pair,
      object,
      divergence: divergence(candidate, object, ctx.cfg),
      humanFlags: flags,
      doNotTouch: flags.some((f) => f.kind === 'do_not_touch'),
    })
  }

  const suggested = [...targets]
    .filter((t) => t.pair.pairClass === 'linked' || t.pair.pairClass === 'probable')
    .sort((a, b) => rank(a.pair) - rank(b.pair) || a.pair.distanceM - b.pair.distanceM)[0]

  if (suggested) {
    for (const f of suggested.humanFlags) {
      if (f.kind === 'recent_human_edit') warnings.add('recent_human_edit')
      if (f.kind === 'survey_date' && f.recent) warnings.add('recent_survey')
      if (f.kind === 'do_not_touch') warnings.add('do_not_touch')
    }
    if (suggested.divergence.conflicts.length > 0) warnings.add('conflicts')
    if (suggested.divergence.moved) warnings.add('moved')
  }
  if (
    targets.filter((t) => t.pair.pairClass === 'linked' || t.pair.pairClass === 'probable').length >
    1
  ) {
    warnings.add('multiple_candidates')
  }
  if (candidate.status !== undefined && candidate.status !== 'operational')
    warnings.add('not_operational')
  if (candidate.notes !== undefined) warnings.add('adapter_notes')
  if (decision?.superseded) warnings.add('superseded')

  const row: RowModel = {
    candidate,
    match,
    targets,
    noop: suggested !== undefined && !suggested.divergence.updateNeeded,
    warnings: [...warnings],
    decided: decision !== undefined && !decision.superseded,
  }
  if (suggested) {
    row.suggested = suggested
    row.updateNeeded = suggested.divergence.updateNeeded
  }
  const nearest = match.pairs.find((p) => !p.reasons.includes('other_ref'))
  if (nearest) row.nearestM = nearest.distanceM
  if (decision) row.decision = decision
  return row
}

export const DECISION_PROBLEMS = [
  'update_without_target',
  'target_not_nearby',
  'target_do_not_touch',
  'update_changes_nothing',
  'reject_without_reason',
  'add_without_tags',
  'add_when_linked',
] as const
export type DecisionProblem = (typeof DECISION_PROBLEMS)[number]

/** Checks a decision before it is stored or batched. Pure. */
export function validateDecision(row: RowModel, d: Decision): DecisionProblem[] {
  const out: DecisionProblem[] = []
  if (d.action === 'update') {
    if (!d.target) return ['update_without_target']
    const t = row.targets.find(
      (x) => x.object.osmType === d.target!.osmType && x.object.osmId === d.target!.osmId,
    )
    if (!t) return ['target_not_nearby']
    if (t.doNotTouch) out.push('target_do_not_touch')
    const changes = d.tags ?? {}
    if (!d.move && Object.entries(changes).every(([k, v]) => t.object.tags[k] === v))
      out.push('update_changes_nothing')
  }
  if (d.action === 'reject' && d.reasonCode === undefined) out.push('reject_without_reason')
  if (d.action === 'add' && (d.tags === undefined || Object.keys(d.tags).length === 0))
    out.push('add_without_tags')
  // Linked: an OSM object already carries this record's ref, so an Add can only duplicate it.
  if (d.action === 'add' && row.match.class === 'linked') out.push('add_when_linked')
  return out
}
