import { describe, expect, test } from 'vitest'
import {
  compareRows,
  computeStats,
  DEFAULT_FILTERS,
  distanceBand,
  filterAndSort,
  filtersFromQuery,
  filtersToQuery,
  type Filters,
} from '../../../src/review'
import { offset, ORIGIN } from '../match/helpers'
import { cand, decision, obj, rows } from './helpers'

const LIVE = { amenity: 'charging_station' }
const SAME_OP = { ...LIVE, operator: 'Example Energy' }

// A small, varied queue: each candidate 10 km from the next, each in a clear situation.
const at = (km: number) => offset(ORIGIN.lon, ORIGIN.lat, km * 1000)
const near = (km: number, m: number) => offset(at(km).lon, at(km).lat, m, 0)
const cA = cand({ label: 'Sofia Mall', address: 'бул. Витоша 1, София', sourceId: '10' }) // linked, nothing to change
const cB = cand({ label: 'Plovdiv Center', sourceId: '2', ...at(10) }) // probable, needs ref
const cC = cand({ label: 'Varna Port', sourceId: '33', notes: 'check', ...at(20) }) // nothing nearby
const cD = cand({ label: 'Burgas', sourceId: '4', ...at(30) }) // only a possible match
const all = rows(
  [cA, cB, cC, cD],
  [obj(3, { ...cA.tags }), obj(0, SAME_OP, near(10, 10)), obj(0, LIVE, near(30, 80))],
  {
    [cB.sourceId]: decision({ action: 'add', decidedAt: '2026-09-28T12:00:00Z' }),
    [cC.sourceId]: decision({ action: 'reject', superseded: true }),
  },
)
const f = (over: Partial<Filters>) =>
  filterAndSort(all, { ...DEFAULT_FILTERS, ...over }).map((r) => r.candidate.sourceId)

describe('filters', () => {
  test('default: everything, numeric-aware id order', () =>
    expect(f({})).toEqual(['2', '4', '10', '33']))
  test('class', () => expect(f({ classes: ['probable', 'linked'] })).toEqual(['2', '10']))
  test('decided', () => {
    expect(f({ decided: 'decided' })).toEqual(['2'])
    expect(f({ decided: 'undecided' })).toEqual(['4', '10', '33'])
    expect(f({ decided: 'superseded' })).toEqual(['33'])
  })
  test('action', () => expect(f({ actions: ['reject'] })).toEqual(['33']))
  test('no-op vs update needed', () => {
    expect(f({ change: 'noop' })).toEqual(['10'])
    expect(f({ change: 'update_needed' })).toEqual(['2'])
  })
  test('warnings only', () => expect(f({ warningsOnly: true })).toEqual(['33']))
  test('distance band', () => {
    expect(f({ distance: ['0-5'] })).toEqual(['10'])
    expect(f({ distance: ['5-15', '50-150'] })).toEqual(['2', '4'])
    expect(f({ distance: ['none'] })).toEqual(['33'])
  })
  test('free text is accent- and case-insensitive over label, address and id', () => {
    expect(f({ text: 'vitosha' })).toEqual([])
    expect(f({ text: 'витоша' })).toEqual(['10'])
    expect(f({ text: 'PLOVDIV cent' })).toEqual(['2'])
    expect(f({ text: '33' })).toEqual(['33'])
    expect(f({ text: '   ' })).toEqual(['2', '4', '10', '33'])
  })
  test('region uses the supplied lookup', () => {
    const regionOf = (r: (typeof all)[number]) =>
      r.candidate.sourceId === '4' ? 'Burgas' : 'Other'
    expect(
      filterAndSort(all, { ...DEFAULT_FILTERS, region: 'Burgas' }, regionOf).map(
        (r) => r.candidate.sourceId,
      ),
    ).toEqual(['4'])
  })
  test('filters combine', () => expect(f({ decided: 'undecided', text: 'varna' })).toEqual(['33']))
})

describe('sorting', () => {
  test('by label, descending', () =>
    expect(f({ sort: 'label', desc: true })).toEqual(['33', '10', '2', '4']))
  test('by decision time', () => expect(f({ sort: 'decided_at' })).toEqual(['4', '10', '33', '2']))
  test('by distance, unmatched last', () => {
    const r = rows([cand({ sourceId: 'far' }), cand({ sourceId: 'near' })], [obj(1, LIVE)])
    // both candidates sit on the same origin → equal distance, tie-broken by id
    expect(
      filterAndSort(r, { ...DEFAULT_FILTERS, sort: 'distance' }).map((x) => x.candidate.sourceId),
    ).toEqual(['far', 'near'])
    const lone = rows([cand({ sourceId: 'x' })], [])
    expect(
      filterAndSort([...lone, ...r], { ...DEFAULT_FILTERS, sort: 'distance' })[2]!.candidate
        .sourceId,
    ).toBe('x')
  })
})

test.each([
  [undefined, 'none'],
  [5, '0-5'],
  [5.1, '5-15'],
  [15, '5-15'],
  [50, '15-50'],
  [150, '50-150'],
])('distanceBand(%s) = %s', (nearestM, band) => {
  expect(distanceBand(nearestM === undefined ? {} : { nearestM })).toBe(band)
})

describe('URL state', () => {
  test('defaults serialise to an empty query', () =>
    expect(filtersToQuery(DEFAULT_FILTERS)).toBe(''))

  test('round-trips every field', () => {
    const full: Filters = {
      classes: ['linked', 'none'],
      decided: 'undecided',
      actions: ['add', 'update'],
      change: 'noop',
      warningsOnly: true,
      distance: ['0-5', 'none'],
      text: 'Sofia & Varna',
      region: 'Община Бургас',
      sort: 'label',
      desc: true,
    }
    expect(filtersFromQuery(filtersToQuery(full))).toEqual(full)
  })

  test('garbage is dropped, not thrown', () => {
    expect(filtersFromQuery('class=linked,bogus&decided=maybe&sort=random&dist=far')).toEqual({
      ...DEFAULT_FILTERS,
      classes: ['linked'],
    })
  })
})

test('stats reconcile', () => {
  const s = computeStats(all)
  expect(s.total).toBe(4)
  expect(Object.values(s.byClass).reduce((a, b) => a + b)).toBe(4)
  expect(Object.values(s.byAction).reduce((a, b) => a + b)).toBe(4)
  expect(s.byAction).toMatchObject({ add: 1, undecided: 3, reject: 0 })
  expect(s.matched).toEqual({ updateNeeded: 1, noop: 1 })
  expect(s.superseded).toBe(1)
  expect(s.withWarnings).toBe(1)
})

describe('compareRows directly', () => {
  const [m] = rows([cand({ sourceId: 'm' })], [obj(10, LIVE)])
  const [u] = rows([cand({ sourceId: 'u', label: undefined })], [])
  test('unmatched sorts after matched by distance, both ways', () => {
    expect(compareRows(m!, u!, 'distance')).toBeLessThan(0)
    expect(compareRows(u!, m!, 'distance')).toBeGreaterThan(0)
  })
  test('missing labels sort first', () => {
    expect(
      compareRows(u!, { ...m!, candidate: { ...m!.candidate, label: 'A' } }, 'label'),
    ).toBeLessThan(0)
    expect(
      compareRows({ ...m!, candidate: { ...m!.candidate, label: 'A' } }, u!, 'label'),
    ).toBeGreaterThan(0)
  })
  test('ties fall back to the source id (including two unmatched rows: Infinity − Infinity)', () => {
    const [a] = rows([cand({ sourceId: 'a', label: 'Same' })], [])
    const [b] = rows([cand({ sourceId: 'b', label: 'Same' })], [])
    expect(compareRows(a!, b!, 'label')).toBeLessThan(0)
    expect(compareRows(a!, b!, 'distance')).toBeLessThan(0)
  })
})
