import type { BBox } from '../../geo/distance'
import type { OsmObject, OsmType } from '../types'
import { LIFECYCLE_PREFIXES } from './overpassQuery'

/**
 * Stations from the OSM API's own map call (`/api/0.6/map.json?bbox=`). The
 * sandbox has no Overpass, so this is how matching sees sandbox data
 * when testing against it. The filter is the Overpass query's, so both sources agree.
 */

/** The API refuses map requests over this area (square degrees). */
export const MAX_MAP_AREA_DEG2 = 0.25

export const bboxAreaDeg2 = (b: BBox): number => (b.maxLon - b.minLon) * (b.maxLat - b.minLat)

/** Same selection as buildStationQuery. */
export function isStationObject(tags: Record<string, string>, refKey: string): boolean {
  return (
    tags.amenity === 'charging_station' ||
    LIFECYCLE_PREFIXES.some((p) => tags[`${p}:amenity`] === 'charging_station') ||
    refKey in tags
  )
}

export class MapParseError extends Error {
  override name = 'MapParseError'
}

interface RawElement {
  type: string
  id: number
  version: number
  lat?: number
  lon?: number
  nodes?: number[]
  members?: { type: string; ref: number }[]
  tags?: Record<string, string>
  user?: string
  uid?: number
  timestamp?: string
  changeset?: number
}

type Pos = { lat: number; lon: number }

const mean = (ps: Pos[]): Pos | undefined =>
  ps.length === 0
    ? undefined
    : {
        lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length,
        lon: ps.reduce((s, p) => s + p.lon, 0) / ps.length,
      }

/**
 * Parse a map response into stations. Ways and relations get the mean of the
 * member positions the response contains; a station with none is returned in
 * `unpositioned` rather than guessed at.
 */
export function parseApiMapJson(
  data: unknown,
  refKey: string,
): { objects: OsmObject[]; unpositioned: string[] } {
  const els = (data as { elements?: unknown } | null)?.elements
  if (!Array.isArray(els)) throw new MapParseError('response has no elements array')
  const elements = els as RawElement[]

  const nodePos = new Map<number, Pos>()
  for (const e of elements)
    if (e.type === 'node' && typeof e.lat === 'number' && typeof e.lon === 'number')
      nodePos.set(e.id, { lat: e.lat, lon: e.lon })
  const wayPos = new Map<number, Pos>()
  for (const e of elements) {
    if (e.type !== 'way') continue
    const p = mean((e.nodes ?? []).flatMap((n) => nodePos.get(n) ?? []))
    if (p) wayPos.set(e.id, p)
  }
  const position = (e: RawElement): Pos | undefined => {
    if (e.type === 'node') return nodePos.get(e.id)
    if (e.type === 'way') return wayPos.get(e.id)
    return mean(
      (e.members ?? []).flatMap(
        (m) => (m.type === 'node' ? nodePos.get(m.ref) : wayPos.get(m.ref)) ?? [],
      ),
    )
  }

  const objects: OsmObject[] = []
  const unpositioned: string[] = []
  for (const e of elements) {
    if (!['node', 'way', 'relation'].includes(e.type))
      throw new MapParseError(`unknown type ${e.type}`)
    const tags = e.tags ?? {}
    if (!isStationObject(tags, refKey)) continue
    const p = position(e)
    if (!p) {
      unpositioned.push(`${e.type}/${e.id}`)
      continue
    }
    objects.push({
      osmType: e.type as OsmType,
      osmId: e.id,
      version: e.version,
      lat: p.lat,
      lon: p.lon,
      tags,
      lastEditUser: e.user ?? '',
      lastEditUid: e.uid ?? 0,
      lastEditAt: e.timestamp ?? '',
      changeset: e.changeset ?? 0,
    })
  }
  return { objects, unpositioned }
}
