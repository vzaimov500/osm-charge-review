import { DISTANCE_EPSILON_M, distanceM, GridIndex } from '../geo/distance'
import type { Candidate } from '../format'
import { LIFECYCLE_PREFIXES } from '../osm/build/overpassQuery'
import { osmKey, type OsmObject } from '../osm/types'
import type { MatchConfig } from './config'
import { compareValues } from './normalise'

/**
 * Classes, in precedence order. `lifecycle` is its own class: a
 * nearby object someone deliberately marked as gone or not yet built.
 */
export const MATCH_CLASSES = ['linked', 'probable', 'lifecycle', 'possible', 'none'] as const
export type MatchClass = (typeof MATCH_CLASSES)[number]

export type PairReason =
  | 'ref_match'
  | 'other_ref'
  | 'within_probable_radius'
  | 'within_possible_radius'
  | 'operator_match'
  | 'brand_match'
  | 'network_match'
  | 'operator_differs'
  | 'no_operator_info'
  | 'lifecycle'

/** One candidate ↔ object pair, with the reasons that fired (the reviewer must see why). */
export interface MatchPair {
  osmType: OsmObject['osmType']
  osmId: number
  distanceM: number
  /** What this pair alone would make the candidate. */
  pairClass: MatchClass
  reasons: PairReason[]
}

export interface CandidateMatch {
  sourceId: string
  class: MatchClass
  /** All nearby and linked objects, nearest first. Never assumed one-to-one. */
  pairs: MatchPair[]
  /** Effective radii after widening by position_accuracy_m. */
  radii: { probableM: number; possibleM: number }
}

const IDENTITY_KEYS = ['operator', 'brand', 'network'] as const
const REASON_FOR: Record<(typeof IDENTITY_KEYS)[number], PairReason> = {
  operator: 'operator_match',
  brand: 'brand_match',
  network: 'network_match',
}

export function isLive(o: OsmObject): boolean {
  return o.tags.amenity === 'charging_station'
}

export function lifecyclePrefix(o: OsmObject): string | undefined {
  if (isLive(o)) return undefined
  return LIFECYCLE_PREFIXES.find((p) => o.tags[`${p}:amenity`] === 'charging_station')
}

export function classifyPair(
  c: Candidate,
  o: OsmObject,
  refKey: string,
  d: number,
  radii: CandidateMatch['radii'],
): MatchPair {
  const reasons: PairReason[] = []
  const pair = (pairClass: MatchClass): MatchPair => ({
    osmType: o.osmType,
    osmId: o.osmId,
    distanceM: d,
    pairClass,
    reasons,
  })

  const osmRef = o.tags[refKey]
  if (c.ref !== undefined && osmRef !== undefined) {
    if (compareValues(refKey, c.ref, osmRef) === 'equal') {
      reasons.push('ref_match')
      if (lifecyclePrefix(o)) reasons.push('lifecycle')
      return pair('linked')
    }
    // Already linked to a different provider record: shown, never proposed.
    reasons.push('other_ref')
    return pair('none')
  }

  const inProbable = d <= radii.probableM + DISTANCE_EPSILON_M
  if (inProbable) reasons.push('within_probable_radius')
  else if (d <= radii.possibleM + DISTANCE_EPSILON_M) reasons.push('within_possible_radius')
  else return pair('none')

  if (lifecyclePrefix(o)) {
    reasons.push('lifecycle')
    return pair(inProbable ? 'lifecycle' : 'possible')
  }
  if (!isLive(o)) return pair('none') // e.g. carries only the ref key

  let anyComparable = false
  let anyMatch = false
  for (const k of IDENTITY_KEYS) {
    const a = c.tags[k]
    const b = o.tags[k]
    if (a === undefined || b === undefined) continue
    anyComparable = true
    if (compareValues(k, a, b) !== 'different') {
      anyMatch = true
      reasons.push(REASON_FOR[k])
    }
  }
  if (!anyComparable) reasons.push('no_operator_info')
  else if (!anyMatch) reasons.push('operator_differs')

  if (inProbable) return pair(anyMatch ? 'probable' : 'possible')
  // 50–150 m: a brand match; anything else nearby is still shown as possible.
  return pair('possible')
}

/**
 * Classify every candidate against the fetched OSM objects. Pure; O(n) via a
 * grid index. Never auto-merges and never picks an action.
 */
export function classifyAll(
  candidates: readonly Candidate[],
  objects: readonly OsmObject[],
  refKey: string,
  cfg: Pick<MatchConfig, 'probableRadiusM' | 'possibleRadiusM'>,
): CandidateMatch[] {
  const index = new GridIndex(objects, cfg.possibleRadiusM)
  const byRef = new Map<string, OsmObject[]>()
  for (const o of objects) {
    const r = o.tags[refKey]
    if (r === undefined) continue
    const list = byRef.get(r.trim())
    if (list) list.push(o)
    else byRef.set(r.trim(), [o])
  }

  return candidates.map((c) => {
    const widen = c.positionAccuracyM ?? 0
    const radii = { probableM: cfg.probableRadiusM + widen, possibleM: cfg.possibleRadiusM + widen }
    const seen = new Set<string>()
    const pairs: MatchPair[] = []
    const consider = (o: OsmObject) => {
      const k = osmKey(o)
      if (seen.has(k)) return
      seen.add(k)
      const p = classifyPair(c, o, refKey, distanceM(c, o), radii)
      if (p.pairClass !== 'none' || p.reasons.includes('other_ref')) pairs.push(p)
    }
    if (c.ref !== undefined) for (const o of byRef.get(c.ref.trim()) ?? []) consider(o)
    for (const i of index.within(c, radii.possibleM + DISTANCE_EPSILON_M)) consider(objects[i]!)

    pairs.sort(
      (a, b) =>
        a.distanceM - b.distanceM ||
        MATCH_CLASSES.indexOf(a.pairClass) - MATCH_CLASSES.indexOf(b.pairClass),
    )
    const best = pairs.reduce<MatchClass>(
      (acc, p) =>
        MATCH_CLASSES.indexOf(p.pairClass) < MATCH_CLASSES.indexOf(acc) ? p.pairClass : acc,
      'none',
    )
    return { sourceId: c.sourceId, class: best, pairs, radii }
  })
}

/** Per-class counts; they always sum to the number of candidates. */
export function classCounts(matches: readonly CandidateMatch[]): Record<MatchClass, number> {
  const out = Object.fromEntries(MATCH_CLASSES.map((c) => [c, 0])) as Record<MatchClass, number>
  for (const m of matches) out[m.class]++
  return out
}
