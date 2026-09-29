/**
 * Value normalisation for tag comparison. Getting this wrong makes
 * every row look changed, the reviewer stops reading the flags, and the tool
 * does harm. Rules here are deliberately explicit and individually tested.
 *
 * SYNONYMS lists known spelling variants; extend it as they turn up.
 */

export type Comparison =
  /** Equal after normalisation. */
  | 'equal'
  /** Different, but equal ignoring case, whitespace and punctuation (spelling variant). */
  | 'loose'
  /** OSM holds a non-specific value (e.g. `yes`) where the candidate is specific. */
  | 'refines'
  /**
   * OSM is more specific and consistent: e.g. per-connector outputs
   * "120 kW; 180 kW" where the provider only knows the maximum, 180 kW.
   */
  | 'osm_more_specific'
  | 'different'

/** Per-key synonyms: every value in a group is treated as equal. Lower-case. */
export const SYNONYMS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  access: [['yes', 'public']],
}

/** Keys whose values are enumerations: compared case-insensitively. */
const CASE_INSENSITIVE_KEYS =
  /^(access|fee|parking:fee|amenity|authentication:.*|payment:.*|socket:[^:]+|disused:.*|.*:amenity)$/
/** Keys holding names: exact, but a case/punctuation-only difference is reported as `loose`. */
const NAME_KEYS = /^(name|operator|brand|network|owner)(:.*)?$/
/** Power keys: numeric with unit, compared in watts. */
const POWER_KEYS = /(^|:)output$/
/** Count keys: integer counts where OSM may hold `yes`. */
const COUNT_KEYS = /^(socket:[a-z0-9_]+|capacity)$/

const POWER_UNITS: Readonly<Record<string, number>> = { w: 1, kw: 1e3, mw: 1e6, kva: 1e3 }

/** "22 kW", "22kW", "22000 W", "22,5 kW" → watts. A bare number is taken as kW (common OSM mistake). */
export function parsePowerW(v: string): number | undefined {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Z]*)\s*$/.exec(v)
  if (!m) return undefined
  const n = Number(m[1]!.replace(',', '.'))
  const unit = m[2]!.toLowerCase()
  if (unit === '') return n * 1e3
  const f = POWER_UNITS[unit]
  return f === undefined ? undefined : n * f
}

const splitList = (v: string): string[] =>
  v
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

/** Case/whitespace/punctuation-insensitive form for spelling-variant detection. */
export function looseForm(v: string): string {
  return v
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, '')
}

function canonicalScalar(key: string, v: string): string {
  let s = v.trim().replace(/\s+/g, ' ')
  if (CASE_INSENSITIVE_KEYS.test(key)) s = s.toLowerCase()
  for (const group of SYNONYMS[key] ?? []) if (group.includes(s.toLowerCase())) return group[0]!
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return String(Number(s)) // "02" == "2", "2.0" == "2"
  return s
}

/** Compare a candidate value with the OSM value for the same key. */
export function compareValues(key: string, candidate: string, osm: string): Comparison {
  if (candidate === osm) return 'equal'

  if (POWER_KEYS.test(key)) {
    const a = splitList(candidate).map(parsePowerW)
    const b = splitList(osm).map(parsePowerW)
    if (a.every((x) => x !== undefined) && b.every((x) => x !== undefined)) {
      const sa = [...(a as number[])].sort((x, y) => x - y)
      const sb = [...(b as number[])].sort((x, y) => x - y)
      if (sa.length === sb.length && sa.every((x, i) => Math.abs(x - sb[i]!) < 1e-6)) return 'equal'
      if (sa.length === 1 && sb.length > 1 && Math.abs(sa[0]! - sb[sb.length - 1]!) < 1e-6) {
        return 'osm_more_specific'
      }
      return 'different'
    }
  }

  const ca = splitList(candidate).map((s) => canonicalScalar(key, s))
  const cb = splitList(osm).map((s) => canonicalScalar(key, s))
  if (ca.length === cb.length && [...ca].sort().join(';') === [...cb].sort().join(';'))
    return 'equal'

  if (
    COUNT_KEYS.test(key) &&
    osm.trim().toLowerCase() === 'yes' &&
    /^\d+$/.test(candidate.trim())
  ) {
    return Number(candidate) > 0 ? 'refines' : 'different'
  }
  if (NAME_KEYS.test(key) && looseForm(candidate) === looseForm(osm)) return 'loose'
  return 'different'
}
