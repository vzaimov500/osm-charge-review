import { describe, expect, test } from 'vitest'
import { distanceM } from '../../../src/geo/distance'
import {
  classCounts,
  classifyAll,
  classifyPair,
  DEFAULT_MATCH_CONFIG,
  lifecyclePrefix,
  type MatchClass,
} from '../../../src/match'
import { cand, obj, offset, ORIGIN } from './helpers'

const cfg = DEFAULT_MATCH_CONFIG
const REF = 'ref:example'
const one = (c = cand(), objects = [obj(10, { amenity: 'charging_station' })]) =>
  classifyAll([c], objects, REF, cfg)[0]!
const LIVE = { amenity: 'charging_station' }
const LIVE_SAME_OP = { amenity: 'charging_station', operator: 'Example Energy' }
const LIVE_OTHER_OP = { amenity: 'charging_station', operator: 'Other Co' }

test('the offset helper agrees with distanceM to a micrometre', () => {
  for (const d of [0.5, 49.99, 50, 150.01, 5000])
    expect(distanceM(ORIGIN, offset(ORIGIN.lon, ORIGIN.lat, d, 37))).toBeCloseTo(d, 6)
})

describe('class boundaries', () => {
  test.each<[string, number, Record<string, string>, MatchClass]>([
    ['same operator at 49.99 m', 49.99, LIVE_SAME_OP, 'probable'],
    ['same operator at exactly 50 m', 50, LIVE_SAME_OP, 'probable'],
    ['same operator at 50.01 m', 50.01, LIVE_SAME_OP, 'possible'],
    ['no operator info at 49.99 m', 49.99, LIVE, 'possible'],
    ['other operator at 10 m', 10, LIVE_OTHER_OP, 'possible'],
    ['same brand at 149.99 m', 149.99, { ...LIVE, brand: 'Example' }, 'possible'],
    ['anything at exactly 150 m', 150, LIVE, 'possible'],
    ['anything at 150.01 m', 150.01, LIVE_SAME_OP, 'none'],
  ])('%s → %s', (_, d, tags, expected) => {
    const c = cand({ tags: { ...cand().tags, brand: 'Example' } })
    expect(one(c, [obj(d, tags)]).class).toBe(expected)
  })

  test('nothing nearby → none, with no pairs', () => {
    const m = one(cand(), [])
    expect(m.class).toBe('none')
    expect(m.pairs).toEqual([])
  })

  test('brand or network also make a probable match', () => {
    const c = cand({ tags: { amenity: 'charging_station', brand: 'B', network: 'N' } })
    expect(one(c, [obj(20, { ...LIVE, brand: 'B' })]).pairs[0]!.reasons).toContain('brand_match')
    expect(one(c, [obj(20, { ...LIVE, network: 'N' })]).pairs[0]!.reasons).toContain(
      'network_match',
    )
  })

  test('a spelling variant of the operator still matches', () => {
    expect(one(cand(), [obj(20, { ...LIVE, operator: 'EXAMPLE ENERGY' })]).class).toBe('probable')
  })

  test('reasons explain the class', () => {
    expect(one(cand(), [obj(20, LIVE_OTHER_OP)]).pairs[0]!.reasons).toEqual([
      'within_probable_radius',
      'operator_differs',
    ])
    expect(one(cand(), [obj(20, LIVE)]).pairs[0]!.reasons).toEqual([
      'within_probable_radius',
      'no_operator_info',
    ])
    expect(one(cand(), [obj(80, LIVE)]).pairs[0]!.reasons).toEqual([
      'within_possible_radius',
      'no_operator_info',
    ])
  })
})

describe('position_accuracy_m widens the radii', () => {
  test('probable radius grows by the accuracy', () => {
    const c = cand({ positionAccuracyM: 20 })
    const m = one(c, [obj(65, LIVE_SAME_OP)])
    expect(m.radii).toEqual({ probableM: 70, possibleM: 170 })
    expect(m.class).toBe('probable')
  })
  test('possible radius grows by the accuracy', () => {
    expect(one(cand({ positionAccuracyM: 20 }), [obj(165, LIVE)]).class).toBe('possible')
    expect(one(cand(), [obj(165, LIVE)]).class).toBe('none')
  })
})

describe('linked (reference match)', () => {
  test('matches at any distance', () => {
    const c = cand()
    const m = one(c, [obj(40_000, { ...LIVE, [REF]: c.ref! })])
    expect(m.class).toBe('linked')
    expect(m.pairs[0]!.reasons).toEqual(['ref_match'])
  })

  test('ref comparison tolerates whitespace', () => {
    const c = cand()
    expect(one(c, [obj(5, { ...LIVE, [REF]: ` ${c.ref} ` })]).class).toBe('linked')
  })

  test('wins over a closer probable match', () => {
    const c = cand()
    expect(one(c, [obj(5, LIVE_SAME_OP), obj(500, { ...LIVE, [REF]: c.ref! })]).class).toBe(
      'linked',
    )
  })

  test('an object with a different ref is shown but never proposed', () => {
    const m = one(cand(), [obj(5, { ...LIVE_SAME_OP, [REF]: 'other' })])
    expect(m.class).toBe('none')
    expect(m.pairs[0]).toMatchObject({ pairClass: 'none', reasons: ['other_ref'] })
  })

  test('a candidate without ref is never linked, and the ref key alone does not make a station', () => {
    const c = cand({ ref: undefined })
    const m = one(c, [obj(5, { [REF]: 'x' })])
    expect(m.class).toBe('none')
  })

  test('a linked object with a lifecycle prefix is linked and flagged', () => {
    const c = cand()
    expect(
      one(c, [obj(5, { 'disused:amenity': 'charging_station', [REF]: c.ref! })]).pairs[0]!.reasons,
    ).toEqual(['ref_match', 'lifecycle'])
  })

  test('an object carrying only the ref key within radius is not a station', () => {
    expect(one(cand({ ref: 'mine' }), [obj(5, { 'ref:other': 'x' })]).class).toBe('none')
  })
})

describe('lifecycle class', () => {
  test.each(['disused', 'was', 'demolished', 'removed', 'proposed', 'construction'])(
    '%s: within 50 m → lifecycle',
    (p) => {
      expect(one(cand(), [obj(20, { [`${p}:amenity`]: 'charging_station' })]).class).toBe(
        'lifecycle',
      )
    },
  )

  test('lifecycle 50–150 m away is only possible', () => {
    expect(one(cand(), [obj(100, { 'disused:amenity': 'charging_station' })]).class).toBe(
      'possible',
    )
  })

  test('outranks possible, is outranked by probable', () => {
    const life = obj(30, { 'was:amenity': 'charging_station' })
    expect(one(cand(), [life, obj(20, LIVE)]).class).toBe('lifecycle')
    expect(one(cand(), [life, obj(20, LIVE_SAME_OP)]).class).toBe('probable')
  })

  test('lifecyclePrefix ignores live stations and unrelated objects', () => {
    expect(lifecyclePrefix(obj(0, LIVE))).toBeUndefined()
    expect(lifecyclePrefix(obj(0, { 'disused:amenity': 'fuel' }))).toBeUndefined()
    expect(lifecyclePrefix(obj(0, { 'demolished:amenity': 'charging_station' }))).toBe('demolished')
  })
})

describe('many-to-many (never assume one-to-one)', () => {
  test('all pairs are kept, nearest first', () => {
    const m = one(cand(), [obj(120, LIVE), obj(10, LIVE_SAME_OP), obj(40, LIVE_OTHER_OP)])
    expect(m.pairs.map((p) => Math.round(p.distanceM))).toEqual([10, 40, 120])
  })

  test('two candidates at a multi-bay site may both match the same object', () => {
    const o = obj(10, LIVE_SAME_OP)
    const [a, b] = classifyAll([cand(), cand()], [o], REF, cfg)
    expect(a!.pairs[0]!.osmId).toBe(o.osmId)
    expect(b!.pairs[0]!.osmId).toBe(o.osmId)
  })

  test('an object found by ref and by radius appears once', () => {
    const c = cand()
    const m = one(c, [obj(5, { ...LIVE, [REF]: c.ref! })])
    expect(m.pairs).toHaveLength(1)
  })

  test('ties in distance are ordered by class', () => {
    const c = cand()
    const m = one(c, [obj(10, LIVE), obj(10, { ...LIVE, [REF]: c.ref! })])
    expect(m.pairs.map((p) => p.pairClass)).toEqual(['linked', 'possible'])
  })
})

test('counts per class reconcile to the total', () => {
  const cands = [cand(), cand(), cand(), cand({ ...offset(ORIGIN.lon, ORIGIN.lat, 5000) }), cand()]
  const objects = [
    obj(10, LIVE_SAME_OP),
    obj(5000 + 999, LIVE),
    obj(30, { 'was:amenity': 'charging_station' }),
    obj(200_000, { ...LIVE, [REF]: cands[4]!.ref! }),
  ]
  const counts = classCounts(classifyAll(cands, objects, REF, cfg))
  expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(cands.length)
  expect(counts.linked).toBe(1)
  expect(counts.none).toBe(1)
})

test('two OSM objects carrying the same ref are both linked (a duplicate in OSM)', () => {
  const c = cand()
  const m = one(c, [obj(5, { ...LIVE, [REF]: c.ref! }), obj(3000, { ...LIVE, [REF]: c.ref! })])
  expect(m.class).toBe('linked')
  expect(m.pairs.filter((p) => p.pairClass === 'linked')).toHaveLength(2)
})

test('classifyPair on its own: beyond the possible radius is none', () => {
  const p = classifyPair(cand({ ref: undefined }), obj(500, LIVE), REF, 500, {
    probableM: 50,
    possibleM: 150,
  })
  expect(p).toMatchObject({ pairClass: 'none', reasons: [] })
})
