/**
 * Tolerance for inclusive distance thresholds ("within 50 m"): floating-point
 * round-trips make an exact 50 m come out as 50.0000000001 m.
 */
export const DISTANCE_EPSILON_M = 1e-3

/** Mean Earth radius in metres (IUGG). */
export const EARTH_RADIUS_M = 6_371_008.8

export interface LonLat {
  lon: number
  lat: number
}

const toRad = (deg: number): number => (deg * Math.PI) / 180

/** Great-circle distance in metres (haversine). Accurate to well under 0.5 % at these scales. */
export function distanceM(a: LonLat, b: LonLat): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Metres per degree of latitude (approximately constant). */
export const M_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_M) / 180

export interface BBox {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

export function bboxOf(points: readonly LonLat[]): BBox | undefined {
  if (points.length === 0) return undefined
  let minLon = Infinity,
    minLat = Infinity,
    maxLon = -Infinity,
    maxLat = -Infinity
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon
    if (p.lat < minLat) minLat = p.lat
    if (p.lon > maxLon) maxLon = p.lon
    if (p.lat > maxLat) maxLat = p.lat
  }
  return { minLon, minLat, maxLon, maxLat }
}

/** Expand a bbox by a margin in metres on every side. */
export function expandBBox(b: BBox, marginM: number): BBox {
  const dLat = marginM / M_PER_DEG_LAT
  const midLat = toRad((b.minLat + b.maxLat) / 2)
  const dLon = marginM / (M_PER_DEG_LAT * Math.max(Math.cos(midLat), 0.01))
  return {
    minLon: Math.max(-180, b.minLon - dLon),
    minLat: Math.max(-90, b.minLat - dLat),
    maxLon: Math.min(180, b.maxLon + dLon),
    maxLat: Math.min(90, b.maxLat + dLat),
  }
}

/**
 * Buckets points into a grid of roughly `cellM`-sized cells so neighbour
 * searches are O(n) instead of O(n²). Returns candidate indices near `p`;
 * callers still check the exact distance.
 */
export class GridIndex<T extends LonLat> {
  private readonly cells = new Map<string, number[]>()
  private readonly cellDegLat: number

  constructor(
    readonly items: readonly T[],
    cellM: number,
  ) {
    this.cellDegLat = cellM / M_PER_DEG_LAT
    items.forEach((p, i) => {
      const k = this.key(this.cellOf(p))
      const list = this.cells.get(k)
      if (list) list.push(i)
      else this.cells.set(k, [i])
    })
  }

  // Longitude cells use the latitude cell size; near the poles cells get
  // narrower in metres, which only makes the search more conservative.
  private cellOf(p: LonLat): [number, number] {
    return [Math.floor(p.lon / this.cellDegLat), Math.floor(p.lat / this.cellDegLat)]
  }

  private key([x, y]: [number, number]): string {
    return `${x}:${y}`
  }

  /** Indices of items within `radiusM` of `p` (exact distance check applied). */
  within(p: LonLat, radiusM: number): number[] {
    const [cx, cy] = this.cellOf(p)
    const latSpan = Math.ceil(radiusM / M_PER_DEG_LAT / this.cellDegLat)
    const cos = Math.max(Math.cos(toRad(p.lat)), 0.01)
    const lonSpan = Math.ceil(radiusM / (M_PER_DEG_LAT * cos) / this.cellDegLat)
    const out: number[] = []
    for (let dx = -lonSpan; dx <= lonSpan; dx++) {
      for (let dy = -latSpan; dy <= latSpan; dy++) {
        for (const i of this.cells.get(this.key([cx + dx, cy + dy])) ?? []) {
          if (distanceM(p, this.items[i]!) <= radiusM) out.push(i)
        }
      }
    }
    return out
  }
}
