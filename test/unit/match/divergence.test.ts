import { describe, expect, test } from 'vitest'
import { DEFAULT_MATCH_CONFIG, divergence, socketVariantOf } from '../../../src/match'
import { offset, ORIGIN } from './helpers'

const cfg = DEFAULT_MATCH_CONFIG
const at = (d: number) => offset(ORIGIN.lon, ORIGIN.lat, d)
const c = (tags: Record<string, string>) => ({ tags, ...ORIGIN })
const o = (tags: Record<string, string>, d = 0) => ({ tags, ...at(d) })

describe('divergence states', () => {
  const r = divergence(
    c({ amenity: 'charging_station', 'socket:type2': '2', fee: 'yes', 'ref:x': '1' }),
    o({ amenity: 'charging_station', 'socket:type2': '1', opening_hours: '24/7', 'ref:x': '1' }),
    cfg,
  )
  const state = (k: string) => r.tags.find((t) => t.key === k)!.state

  test('every state is produced', () => {
    expect(state('amenity')).toBe('same')
    expect(state('ref:x')).toBe('same')
    expect(state('fee')).toBe('missing_in_osm')
    expect(state('socket:type2')).toBe('differs')
    expect(state('opening_hours')).toBe('only_in_osm')
  })

  test('candidate keys first (sorted), then OSM-only keys', () => {
    expect(r.tags.map((t) => t.key)).toEqual([
      'amenity',
      'fee',
      'ref:x',
      'socket:type2',
      'opening_hours',
    ])
  })

  test('update needed, socket mismatch flagged, surveyed conflict listed', () => {
    expect(r.updateNeeded).toBe(true)
    expect(r.flags).toEqual(['socket_count_mismatch'])
    expect(r.conflicts).toEqual(['socket:type2'])
  })

  test('only_in_osm keys never make an update needed (never deleted)', () => {
    const r2 = divergence(
      c({ amenity: 'charging_station' }),
      o({ amenity: 'charging_station', opening_hours: '24/7' }),
      cfg,
    )
    expect(r2.updateNeeded).toBe(false)
  })
})

describe('no-op rows', () => {
  test('everything equal after normalisation → no update', () => {
    const r = divergence(
      c({
        amenity: 'charging_station',
        'socket:type2_combo:output': '50 kW',
        access: 'yes',
        capacity: '2',
      }),
      o(
        {
          amenity: 'charging_station',
          'socket:type2_combo:output': '50kW',
          access: 'public',
          capacity: '2.0',
        },
        10,
      ),
      cfg,
    )
    expect(r.updateNeeded).toBe(false)
    expect(r.flags).toEqual([])
    expect(r.tags.every((t) => t.state === 'same')).toBe(true)
  })
})

describe('moved', () => {
  test('25 m is not moved; 25.01 m is', () => {
    expect(divergence(c({}), o({}, 25), cfg).moved).toBe(false)
    const r = divergence(c({}), o({}, 25.01), cfg)
    expect(r.moved).toBe(true)
    expect(r.flags).toEqual(['moved'])
    expect(r.updateNeeded).toBe(true)
  })

  test('threshold is configurable', () => {
    expect(divergence(c({}), o({}, 30), { ...cfg, movedThresholdM: 40 }).moved).toBe(false)
  })
})

describe('inconsistency flags', () => {
  test.each([
    [
      { 'socket:type2_combo:output': '50 kW' },
      { 'socket:type2_combo:output': '150 kW' },
      ['power_mismatch'],
    ],
    [{ access: 'yes' }, { access: 'customers' }, ['access_mismatch']],
    [{ fee: 'yes' }, { fee: 'no' }, ['fee_mismatch']],
    [{ operator: 'Fines' }, { operator: 'Eldrive' }, ['operator_mismatch']],
    [{ operator: 'Fines Energy' }, { operator: 'FINES energy' }, ['operator_spelling']],
    [{ network: 'X' }, { network: 'Y' }, ['operator_mismatch']],
    [{ brand: 'X' }, { brand: 'x' }, ['operator_spelling']],
    [{ description: 'a' }, { description: 'b' }, []],
  ])('%j vs %j → %j', (cand, osm, flags) => {
    expect(divergence(c(cand), o(osm), cfg).flags).toEqual(flags)
  })
})

describe('surveyed keys and conflicts', () => {
  test('a differs on a surveyed key is a conflict; on another key it is not', () => {
    const r = divergence(
      c({ opening_hours: '24/7', description: 'a' }),
      o({ opening_hours: 'Mo-Fr 08:00-18:00', description: 'b' }),
      cfg,
    )
    expect(r.conflicts).toEqual(['opening_hours'])
    expect(r.tags.find((t) => t.key === 'description')!.surveyed).toBe(false)
  })

  test.each([
    'socket:type2',
    'socket:type2_combo:output',
    'payment:cards',
    'authentication:app',
    'name',
    'parking:fee',
  ])('%s is surveyed', (k) => {
    expect(divergence(c({ [k]: '1' }), o({ [k]: '2' }), cfg).conflicts).toEqual([k])
  })

  test('OSM "yes" refined by a count is not a conflict and not a socket mismatch', () => {
    const r = divergence(c({ 'socket:type2': '2' }), o({ 'socket:type2': 'yes' }), cfg)
    const t = r.tags[0]!
    expect(t).toMatchObject({ state: 'differs', nuance: 'osm_unspecific' })
    expect(r.conflicts).toEqual([])
    expect(r.flags).toEqual([])
    expect(r.updateNeeded).toBe(true)
  })

  test('a spelling variant is marked as such and remains a conflict on a surveyed key', () => {
    const r = divergence(c({ operator: 'Fines' }), o({ operator: 'FINES' }), cfg)
    expect(r.tags[0]!.nuance).toBe('spelling')
    expect(r.conflicts).toEqual(['operator'])
  })
})

test('per-connector outputs in OSM consistent with the provider maximum are the same, not a mismatch', () => {
  const r = divergence(
    c({ 'socket:type2_combo:output': '180 kW' }),
    o({ 'socket:type2_combo:output': '120 kW; 180 kW' }),
    cfg,
  )
  expect(r.tags[0]).toMatchObject({ state: 'same', nuance: 'osm_more_specific' })
  expect(r.updateNeeded).toBe(false)
  expect(r.flags).toEqual([])
})

describe('socket variants (cable attached or not)', () => {
  test('candidate type2_cable where OSM has type2: conflict, not a plain addition', () => {
    const r = divergence(
      c({ 'socket:type2_cable': '2', 'socket:type2_cable:output': '22 kW' }),
      o({ 'socket:type2': '2', 'socket:type2:output': '22 kW' }),
      cfg,
    )
    expect(r.tags.slice(0, 2)).toMatchObject([
      {
        key: 'socket:type2_cable',
        state: 'missing_in_osm',
        nuance: 'variant_in_osm',
        variantKey: 'socket:type2',
      },
      {
        key: 'socket:type2_cable:output',
        state: 'missing_in_osm',
        nuance: 'variant_in_osm',
        variantKey: 'socket:type2:output',
      },
    ])
    expect(r.flags).toEqual(['socket_variant_conflict'])
    expect(r.conflicts).toEqual(['socket:type2_cable', 'socket:type2_cable:output'])
  })

  test('and the other way round', () => {
    expect(
      divergence(c({ 'socket:type2': '1' }), o({ 'socket:type2_cable': '1' }), cfg).flags,
    ).toEqual(['socket_variant_conflict'])
  })

  test('both variants present in the candidate: an ordinary addition', () => {
    const r = divergence(
      c({ 'socket:type2': '1', 'socket:type2_cable': '1' }),
      o({ 'socket:type2': '1' }),
      cfg,
    )
    expect(r.flags).toEqual([])
    expect(r.conflicts).toEqual([])
  })

  test('socketVariantOf', () => {
    expect(socketVariantOf('socket:type2')).toBe('socket:type2_cable')
    expect(socketVariantOf('socket:type2_cable:output')).toBe('socket:type2:output')
    expect(socketVariantOf('socket:chademo')).toBeUndefined()
    expect(socketVariantOf('capacity')).toBeUndefined()
  })
})
