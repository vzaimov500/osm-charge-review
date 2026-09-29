import type { BBox } from '../../geo/distance'

/**
 * Lifecycle prefixes (https://wiki.openstreetmap.org/wiki/Lifecycle_prefix).
 * Objects tagged with these are someone's deliberate statement that the
 * station is gone or not yet built; they form their own class.
 */
export const LIFECYCLE_PREFIXES = [
  'disused',
  'abandoned',
  'was',
  'demolished',
  'removed',
  'razed',
  'proposed',
  'planned',
  'construction',
] as const

export interface StationQueryOptions {
  bbox: BBox
  /** Objects carrying this key are fetched even without amenity=charging_station (`linked`). */
  refKey: string
  /** Identification comment; Overpass logs queries, and browsers cannot set User-Agent. */
  identifier: string
  timeoutS?: number
}

const q = (s: string): string => JSON.stringify(s)
const fmt = (n: number): string => n.toFixed(6)

/**
 * One query for the whole dataset area: never one per candidate.
 * `meta` is required for recent-edit checks, `center` gives ways a position.
 */
export function buildStationQuery(o: StationQueryOptions): string {
  const { minLat, minLon, maxLat, maxLon } = o.bbox
  const bbox = [minLat, minLon, maxLat, maxLon].map(fmt).join(',')
  const lines = [
    `/* ${o.identifier.replace(/\*\//g, '')} */`,
    `[out:json][timeout:${o.timeoutS ?? 120}][bbox:${bbox}];`,
    '(',
    `  nwr["amenity"="charging_station"];`,
    ...LIFECYCLE_PREFIXES.map((p) => `  nwr[${q(`${p}:amenity`)}="charging_station"];`),
    `  nwr[${q(o.refKey)}];`,
    ');',
    'out center tags meta;',
  ]
  return lines.join('\n')
}
