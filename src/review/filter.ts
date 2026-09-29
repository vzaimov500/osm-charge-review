import { MATCH_CLASSES, type MatchClass } from '../match'
import { ACTIONS, type Action, type RowModel } from './rows'

export const DISTANCE_BANDS = ['0-5', '5-15', '15-50', '50-150', 'none'] as const
export type DistanceBand = (typeof DISTANCE_BANDS)[number]
export const SORT_KEYS = ['distance', 'source_id', 'label', 'decided_at'] as const
export type SortKey = (typeof SORT_KEYS)[number]
export type DecidedFilter = 'all' | 'undecided' | 'decided' | 'superseded'
export type ChangeFilter = 'all' | 'update_needed' | 'noop'

/** All filters combine with AND; empty arrays mean "any". */
export interface Filters {
  classes: MatchClass[]
  decided: DecidedFilter
  actions: Action[]
  change: ChangeFilter
  warningsOnly: boolean
  distance: DistanceBand[]
  text: string
  region: string
  sort: SortKey
  desc: boolean
}

export const DEFAULT_FILTERS: Filters = {
  classes: [],
  decided: 'all',
  actions: [],
  change: 'all',
  warningsOnly: false,
  distance: [],
  text: '',
  region: '',
  sort: 'source_id',
  desc: false,
}

export function distanceBand(row: Pick<RowModel, 'nearestM'>): DistanceBand {
  const d = row.nearestM
  if (d === undefined) return 'none'
  if (d <= 5) return '0-5'
  if (d <= 15) return '5-15'
  if (d <= 50) return '15-50'
  return '50-150'
}

/** Lower-case, accent-free form for free-text search over label, address and id. */
const fold = (s: string): string => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()

export function matchesFilters(
  row: RowModel,
  f: Filters,
  regionOf?: (row: RowModel) => string | undefined,
): boolean {
  if (f.classes.length > 0 && !f.classes.includes(row.match.class)) return false
  if (f.decided === 'undecided' && row.decided) return false
  if (f.decided === 'decided' && !row.decided) return false
  if (f.decided === 'superseded' && !row.decision?.superseded) return false
  if (f.actions.length > 0 && !(row.decision && f.actions.includes(row.decision.action)))
    return false
  if (f.change === 'update_needed' && row.updateNeeded !== true) return false
  if (f.change === 'noop' && !row.noop) return false
  if (f.warningsOnly && row.warnings.length === 0) return false
  if (f.distance.length > 0 && !f.distance.includes(distanceBand(row))) return false
  if (f.region !== '' && regionOf?.(row) !== f.region) return false
  if (f.text.trim() !== '') {
    const hay = fold(
      [row.candidate.label, row.candidate.address, row.candidate.sourceId]
        .filter(Boolean)
        .join(' '),
    )
    if (
      !fold(f.text)
        .split(/\s+/)
        .filter(Boolean)
        .every((w) => hay.includes(w))
    )
      return false
  }
  return true
}

// Explicit locale: the same list sorts identically for every reviewer.
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export function compareRows(a: RowModel, b: RowModel, key: SortKey): number {
  switch (key) {
    case 'distance':
      return (
        (a.nearestM ?? Infinity) - (b.nearestM ?? Infinity) ||
        collator.compare(a.candidate.sourceId, b.candidate.sourceId)
      )
    case 'label':
      return (
        collator.compare(a.candidate.label ?? '', b.candidate.label ?? '') ||
        collator.compare(a.candidate.sourceId, b.candidate.sourceId)
      )
    case 'decided_at':
      return (
        (a.decision?.decidedAt ?? '').localeCompare(b.decision?.decidedAt ?? '') ||
        collator.compare(a.candidate.sourceId, b.candidate.sourceId)
      )
    case 'source_id':
      return collator.compare(a.candidate.sourceId, b.candidate.sourceId)
  }
}

export function filterAndSort(
  rows: readonly RowModel[],
  f: Filters,
  regionOf?: (row: RowModel) => string | undefined,
): RowModel[] {
  const out = rows.filter((r) => matchesFilters(r, f, regionOf))
  out.sort((a, b) => (f.desc ? -1 : 1) * compareRows(a, b, f.sort))
  return out
}

// ---- URL state (filters are reflected in the URL) -----------------

const list = <T extends string>(v: string | null, allowed: readonly T[]): T[] =>
  (v ?? '').split(',').filter((x): x is T => (allowed as readonly string[]).includes(x))

const one = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T =>
  v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

/** Only non-default values are written, so a clean URL means "no filters". */
export function filtersToQuery(f: Filters): string {
  const p = new URLSearchParams()
  if (f.classes.length) p.set('class', f.classes.join(','))
  if (f.decided !== 'all') p.set('decided', f.decided)
  if (f.actions.length) p.set('action', f.actions.join(','))
  if (f.change !== 'all') p.set('change', f.change)
  if (f.warningsOnly) p.set('warnings', '1')
  if (f.distance.length) p.set('dist', f.distance.join(','))
  if (f.text) p.set('q', f.text)
  if (f.region) p.set('region', f.region)
  if (f.sort !== DEFAULT_FILTERS.sort) p.set('sort', f.sort)
  if (f.desc) p.set('desc', '1')
  return p.toString()
}

/** Tolerant parse: unknown values are dropped, never thrown. */
export function filtersFromQuery(query: string): Filters {
  const p = new URLSearchParams(query)
  return {
    classes: list(p.get('class'), MATCH_CLASSES),
    decided: one(p.get('decided'), ['all', 'undecided', 'decided', 'superseded'] as const, 'all'),
    actions: list(p.get('action'), ACTIONS),
    change: one(p.get('change'), ['all', 'update_needed', 'noop'] as const, 'all'),
    warningsOnly: p.get('warnings') === '1',
    distance: list(p.get('dist'), DISTANCE_BANDS),
    text: p.get('q') ?? '',
    region: p.get('region') ?? '',
    sort: one(p.get('sort'), SORT_KEYS, DEFAULT_FILTERS.sort),
    desc: p.get('desc') === '1',
  }
}
