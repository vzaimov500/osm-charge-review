/**
 * Batch planning: cap the size, group by geography
 * rather than review order, and tag the changeset so a reviewer can find it.
 */
import { bboxOf, distanceM, type LonLat } from '../../geo/distance'

export interface Placed extends LonLat {
  sourceId: string
}

export interface BatchPlanOptions {
  /** Default 50. */
  maxItems?: number
  /** Maximum bbox diagonal of one changeset, km. Default 10. */
  maxSpanKm?: number
}

/**
 * Split items into geographically compact groups: greedy, seeded by the
 * westernmost remaining item, growing by nearest neighbour while the bbox
 * stays within the span and the count within the cap. Deterministic.
 */
export function planBatches<T extends Placed>(
  items: readonly T[],
  o: BatchPlanOptions = {},
): T[][] {
  const maxItems = o.maxItems ?? 50
  const maxSpanM = (o.maxSpanKm ?? 10) * 1000
  const rest = [...items].sort(
    (a, b) => a.lon - b.lon || a.lat - b.lat || a.sourceId.localeCompare(b.sourceId, 'en'),
  )
  const out: T[][] = []
  while (rest.length > 0) {
    const group: T[] = [rest.shift()!]
    while (group.length < maxItems && rest.length > 0) {
      let best = -1
      let bestD = Infinity
      rest.forEach((c, i) => {
        const d = Math.min(...group.map((g) => distanceM(g, c)))
        if (d < bestD) {
          bestD = d
          best = i
        }
      })
      const candidate = rest[best]!
      if (spanM([...group, candidate]) > maxSpanM) break
      group.push(candidate)
      rest.splice(best, 1)
    }
    out.push(group)
  }
  return out
}

/** Without known areas, batches may be this wide: one changeset roughly per city and its surroundings. */
export const FALLBACK_SPAN_KM = 50

export interface PlannedGroup<T> {
  /** The administrative area all items share; undefined for the fallback groups. */
  area?: string
  items: T[]
}

/**
 * One batch per administrative area (e.g. an oblast). An area with more than
 * `maxItems` is split into equal, geographically compact parts; items whose
 * area is unknown are grouped by distance instead. Deterministic.
 */
export function planBatchesByArea<T extends Placed>(
  items: readonly T[],
  areaOf: (item: T) => string | undefined,
  o: { maxItems?: number; fallbackSpanKm?: number } = {},
): PlannedGroup<T>[] {
  const maxItems = o.maxItems ?? 50
  const byArea = new Map<string, T[]>()
  const unknown: T[] = []
  for (const it of items) {
    const a = areaOf(it)
    if (a === undefined) unknown.push(it)
    else byArea.set(a, [...(byArea.get(a) ?? []), it])
  }
  const out: PlannedGroup<T>[] = []
  for (const area of [...byArea.keys()].sort((a, b) => a.localeCompare(b, 'en'))) {
    const its = byArea.get(area)!
    const parts = Math.ceil(its.length / maxItems)
    const size = Math.ceil(its.length / parts)
    for (const g of planBatches(its, { maxItems: size, maxSpanKm: Infinity }))
      out.push({ area, items: g })
  }
  for (const g of planBatches(unknown, {
    maxItems,
    maxSpanKm: o.fallbackSpanKm ?? FALLBACK_SPAN_KM,
  }))
    out.push({ items: g })
  return out
}

/**
 * How an oblast is named in a changeset comment: "област Бургас",
 * "Софийска област". Names that are not Cyrillic are used as they are.
 */
export function oblastLabel(name: string): string {
  if (!/[\u0400-\u04FF]/.test(name)) return name
  return /ска$/.test(name) ? `${name} област` : `област ${name}`
}

export function spanM(points: readonly LonLat[]): number {
  const b = bboxOf(points)
  return b ? distanceM({ lon: b.minLon, lat: b.minLat }, { lon: b.maxLon, lat: b.maxLat }) : 0
}

export interface ChangesetTagInput {
  datasetName: string
  /** Where the data came from (file metadata). */
  source: string
  /** Import wiki page (live), required for live uploads. */
  wikiUrl?: string
  /** Community review thread, required for live uploads. */
  forumUrl?: string
  area?: string
  creates: number
  modifies: number
  createdBy: string
  live: boolean
}

/** Human-readable, reviewable changeset tags. */
export function changesetTags(i: ChangesetTagInput): Record<string, string> {
  const parts = [i.creates ? `${i.creates} added` : '', i.modifies ? `${i.modifies} updated` : '']
    .filter(Boolean)
    .join(', ')
  const comment = `Reviewed ${i.datasetName}${i.area ? ` in ${i.area}` : ''}: ${parts || 'no changes'}`
  const tags: Record<string, string> = {
    comment: comment.slice(0, 255),
    created_by: i.createdBy,
    source: i.source.slice(0, 255),
  }
  if (i.wikiUrl) tags['source:url'] = i.wikiUrl
  if (i.forumUrl) tags['discussion:url'] = i.forumUrl
  if (i.live) tags.import = 'yes'
  return tags
}
