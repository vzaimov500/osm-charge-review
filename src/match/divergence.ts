import { DISTANCE_EPSILON_M, distanceM } from '../geo/distance'
import type { OsmObject } from '../osm/types'
import { matcher, type MatchConfig } from './config'
import { compareValues } from './normalise'

export type DivergenceState = 'same' | 'missing_in_osm' | 'differs' | 'only_in_osm'

export interface TagDivergence {
  key: string
  state: DivergenceState
  candidate?: string
  osm?: string
  /** A plausibly surveyed key. With `differs`, it is a conflict needing a per-key tick. */
  surveyed: boolean
  /**
   * `differs`: a spelling variant, or OSM holds a non-specific value (`yes`).
   * `same`: OSM is more specific than the candidate and consistent with it.
   * `missing_in_osm`: OSM has the variant key instead (`socket:type2` vs
   *   `socket:type2_cable`) — adding would double-count sockets.
   */
  nuance?: 'spelling' | 'osm_unspecific' | 'osm_more_specific' | 'variant_in_osm'
  /** With `variant_in_osm`: the OSM key holding the variant. */
  variantKey?: string
  /** From the adapter's suggestions: offered on Update only, never ticked by default. */
  suggested?: boolean
}

export type InconsistencyFlag =
  | 'socket_count_mismatch'
  | 'power_mismatch'
  | 'access_mismatch'
  | 'fee_mismatch'
  | 'operator_mismatch'
  | 'operator_spelling'
  | 'socket_variant_conflict'
  | 'moved'

export interface Divergence {
  tags: TagDivergence[]
  /** Distance between candidate and object; `moved` when above the threshold. */
  distanceM: number
  moved: boolean
  /** Anything `missing_in_osm`, `differs` or `moved`. Everything else is a no-op. */
  updateNeeded: boolean
  flags: InconsistencyFlag[]
  /** Keys whose overwrite needs an explicit per-key tick. */
  conflicts: string[]
}

const SOCKET_COUNT = /^socket:[a-z0-9_]+$/

/**
 * Socket keys that describe the same physical socket differently: whether a
 * cable is attached. Exactly one is right; only a survey can say which.
 */
const SOCKET_VARIANTS: readonly (readonly [string, string])[] = [
  ['socket:type2', 'socket:type2_cable'],
]

export function socketVariantOf(key: string): string | undefined {
  const m = /^(socket:[a-z0-9_]+)(:.*)?$/.exec(key)
  if (!m) return undefined
  for (const [a, b] of SOCKET_VARIANTS) {
    if (m[1] === a) return b + (m[2] ?? '')
    if (m[1] === b) return a + (m[2] ?? '')
  }
  return undefined
}
const POWER = /(^|:)output$/
const NAMEY = /^(operator|brand|network)$/

/**
 * Field-by-field comparison of a candidate's effective tags with an existing
 * object. Pure. `only_in_osm` keys are reported, never proposed for
 * deletion.
 */
export function divergence(
  candidate: { tags: Record<string, string>; lat: number; lon: number },
  osm: Pick<OsmObject, 'tags' | 'lat' | 'lon'>,
  cfg: Pick<MatchConfig, 'movedThresholdM' | 'surveyedKeys'>,
  suggested: Readonly<Record<string, string>> = {},
): Divergence {
  const surveyed = matcher(cfg.surveyedKeys)
  const tags: TagDivergence[] = []
  const flags = new Set<InconsistencyFlag>()

  for (const key of Object.keys(suggested).sort()) {
    if (key in candidate.tags) continue
    const cv = suggested[key]!
    const ov = osm.tags[key]
    const base = { key, candidate: cv, surveyed: surveyed(key), suggested: true }
    if (ov === undefined) tags.push({ ...base, state: 'missing_in_osm' })
    else if (compareValues(key, cv, ov) === 'equal') tags.push({ ...base, osm: ov, state: 'same' })
    else tags.push({ ...base, osm: ov, state: 'differs' })
  }

  for (const key of Object.keys(candidate.tags).sort()) {
    const cv = candidate.tags[key]!
    const ov = osm.tags[key]
    const base = { key, candidate: cv, surveyed: surveyed(key) }
    if (ov === undefined) {
      const variant = socketVariantOf(key)
      if (
        variant !== undefined &&
        osm.tags[variant] !== undefined &&
        candidate.tags[variant] === undefined
      ) {
        tags.push({
          ...base,
          state: 'missing_in_osm',
          nuance: 'variant_in_osm',
          variantKey: variant,
        })
        flags.add('socket_variant_conflict')
      } else {
        tags.push({ ...base, state: 'missing_in_osm' })
      }
      continue
    }
    const cmp = compareValues(key, cv, ov)
    if (cmp === 'equal') {
      tags.push({ ...base, osm: ov, state: 'same' })
      continue
    }
    if (cmp === 'osm_more_specific') {
      tags.push({ ...base, osm: ov, state: 'same', nuance: 'osm_more_specific' })
      continue
    }
    const t: TagDivergence = { ...base, osm: ov, state: 'differs' }
    if (cmp === 'loose') t.nuance = 'spelling'
    if (cmp === 'refines') t.nuance = 'osm_unspecific'
    tags.push(t)

    if (SOCKET_COUNT.test(key) && cmp !== 'refines') flags.add('socket_count_mismatch')
    if (POWER.test(key)) flags.add('power_mismatch')
    if (key === 'access') flags.add('access_mismatch')
    if (key === 'fee') flags.add('fee_mismatch')
    if (NAMEY.test(key)) flags.add(cmp === 'loose' ? 'operator_spelling' : 'operator_mismatch')
  }
  tags.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  for (const key of Object.keys(osm.tags).sort()) {
    if (!(key in candidate.tags) && !(key in suggested))
      tags.push({ key, osm: osm.tags[key]!, state: 'only_in_osm', surveyed: surveyed(key) })
  }

  const d = distanceM(candidate, osm)
  const moved = d > cfg.movedThresholdM + DISTANCE_EPSILON_M
  if (moved) flags.add('moved')

  const conflicts = tags
    .filter(
      (t) =>
        (t.state === 'differs' && t.surveyed && t.nuance !== 'osm_unspecific') ||
        t.nuance === 'variant_in_osm' ||
        (t.suggested && t.state !== 'same'),
    )
    .map((t) => t.key)
  // A suggestion alone never makes an update necessary.
  const updateNeeded =
    moved ||
    tags.some((t) => !t.suggested && (t.state === 'missing_in_osm' || t.state === 'differs'))
  return { tags, distanceM: d, moved, updateNeeded, flags: [...flags], conflicts }
}
