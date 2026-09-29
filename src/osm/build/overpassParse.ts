import type { OsmObject, OsmType } from '../types'

export class OverpassParseError extends Error {
  override name = 'OverpassParseError'
}

const TYPES: readonly string[] = ['node', 'way', 'relation']

/**
 * Parse an Overpass JSON response (`out center tags meta`). Strict: a
 * malformed element is an error rather than a silently missing station.
 */
export function parseOverpassJson(data: unknown): {
  objects: OsmObject[]
  timestampOsmBase?: string
} {
  if (data === null || typeof data !== 'object')
    throw new OverpassParseError('response is not a JSON object')
  const d = data as {
    elements?: unknown
    remark?: unknown
    osm3s?: { timestamp_osm_base?: unknown }
  }
  // Overpass reports runtime errors (timeouts, memory) in `remark` with HTTP 200.
  if (typeof d.remark === 'string' && /error/i.test(d.remark)) {
    throw new OverpassParseError(`Overpass reported: ${d.remark}`)
  }
  if (!Array.isArray(d.elements)) throw new OverpassParseError('response has no elements array')

  const objects = d.elements.map((raw: unknown, i): OsmObject => {
    const e = raw as Record<string, unknown>
    const bad = (why: string) => new OverpassParseError(`element ${i}: ${why}`)
    if (typeof e.type !== 'string' || !TYPES.includes(e.type))
      throw bad(`unknown type ${String(e.type)}`)
    const osmType = e.type as OsmType
    const pos = osmType === 'node' ? e : (e.center as Record<string, unknown> | undefined)
    if (!pos || typeof pos.lat !== 'number' || typeof pos.lon !== 'number') {
      throw bad(`${osmType} ${String(e.id)} has no position (was the query run with "out center"?)`)
    }
    if (typeof e.id !== 'number' || typeof e.version !== 'number')
      throw bad('missing id or version (was "meta" requested?)')
    const tags = (e.tags ?? {}) as Record<string, unknown>
    if (Object.values(tags).some((v) => typeof v !== 'string')) throw bad('non-string tag value')
    return {
      osmType,
      osmId: e.id,
      version: e.version,
      lat: pos.lat,
      lon: pos.lon,
      tags: tags as Record<string, string>,
      lastEditUser: typeof e.user === 'string' ? e.user : '',
      lastEditUid: typeof e.uid === 'number' ? e.uid : 0,
      lastEditAt: typeof e.timestamp === 'string' ? e.timestamp : '',
      changeset: typeof e.changeset === 'number' ? e.changeset : 0,
    }
  })
  const ts = d.osm3s?.timestamp_osm_base
  return typeof ts === 'string' ? { objects, timestampOsmBase: ts } : { objects }
}
