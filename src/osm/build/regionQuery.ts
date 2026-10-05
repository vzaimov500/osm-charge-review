/**
 * Region names for candidates in ONE Overpass request: one cheap
 * `is_in` per point, separated by marker elements, returning only area tags —
 * no polygon geometry is downloaded.
 */
import type { LonLat } from '../../geo/distance'

export interface RegionQueryOptions {
  identifier: string
  timeoutS?: number
}

/** The level of the first-order division (an oblast in Bulgaria): batches are planned per area at this level. */
export const OBLAST_ADMIN_LEVEL = 4

export function buildRegionQuery(points: readonly LonLat[], o: RegionQueryOptions): string {
  const lines = [
    `/* ${o.identifier.replace(/\*\//g, '')} */`,
    `[out:json][timeout:${o.timeoutS ?? 120}];`,
  ]
  points.forEach((p, i) => {
    // Overpass requires `make` values to be quoted unless they are expressions.
    lines.push(`make m idx="${i}"; out;`)
    lines.push(
      `is_in(${p.lat.toFixed(6)},${p.lon.toFixed(6)})->.a; area.a["boundary"="administrative"]["admin_level"]; out tags;`,
    )
  })
  return lines.join('\n')
}

interface OverpassElement {
  type: string
  tags?: Record<string, string>
}

/**
 * For each point, the name of the most specific administrative area at or
 * above `maxAdminLevel` (numerically ≤). Undefined where none is found.
 */
export function parseRegionResponse(
  data: unknown,
  count: number,
  maxAdminLevel = 8,
  lang = 'name',
): (string | undefined)[] {
  const out: (string | undefined)[] = new Array<string | undefined>(count).fill(undefined)
  const best: number[] = new Array<number>(count).fill(-1)
  const elements = (data as { elements?: OverpassElement[] } | null)?.elements
  if (!Array.isArray(elements)) return out
  let idx = -1
  for (const e of elements) {
    if (e.type === 'm') {
      idx = Number(e.tags?.idx ?? -1)
      continue
    }
    if (e.type !== 'area' || idx < 0 || idx >= count) continue
    const level = Number(e.tags?.admin_level)
    const name = e.tags?.[lang] ?? e.tags?.name
    if (!Number.isFinite(level) || level > maxAdminLevel || name === undefined) continue
    if (level > best[idx]!) {
      best[idx] = level
      out[idx] = name
    }
  }
  return out
}
