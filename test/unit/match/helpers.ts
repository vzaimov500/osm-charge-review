import { EARTH_RADIUS_M } from '../../../src/geo/distance'
import type { Candidate } from '../../../src/format'
import type { OsmObject } from '../../../src/osm/types'

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Point `distanceM` from (lon, lat) along `bearingDeg`, on the same sphere as distanceM(). */
export function offset(
  lon: number,
  lat: number,
  distanceM: number,
  bearingDeg = 90,
): { lon: number; lat: number } {
  const δ = distanceM / EARTH_RADIUS_M
  const θ = rad(bearingDeg)
  const φ1 = rad(lat)
  const λ1 = rad(lon)
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2))
  return { lon: deg(λ2), lat: deg(φ2) }
}

export const ORIGIN = { lon: 23.3219, lat: 42.6977 }

let nextId = 1
export function cand(over: Partial<Candidate> = {}): Candidate {
  const id = String(nextId++)
  return {
    featureIndex: 0,
    sourceId: id,
    ...ORIGIN,
    tags: { amenity: 'charging_station', operator: 'Example Energy', 'ref:example': id },
    ref: id,
    contentHash: 'h',
    ...over,
  }
}

export function obj(
  distanceM: number,
  tags: Record<string, string>,
  over: Partial<OsmObject> = {},
): OsmObject {
  return {
    osmType: 'node',
    osmId: nextId++,
    version: 1,
    ...offset(ORIGIN.lon, ORIGIN.lat, distanceM),
    tags,
    lastEditUser: 'mapper',
    lastEditUid: 1,
    lastEditAt: '2020-01-01T00:00:00Z',
    changeset: 1,
    ...over,
  }
}
