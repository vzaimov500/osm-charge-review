import { describe, expect, test } from 'vitest'
import { DEFAULT_MATCH_CONFIG, divergence } from '../../../src/match'
import {
  applyChanges,
  changeableKeys,
  changesFor,
  defaultSelection,
  isNoopUpdate,
} from '../../../src/review'
import { ORIGIN } from '../match/helpers'

const div = (cand: Record<string, string>, osm: Record<string, string>) =>
  divergence({ tags: cand, ...ORIGIN }, { tags: osm, ...ORIGIN }, DEFAULT_MATCH_CONFIG)

const d = div(
  {
    amenity: 'charging_station',
    'ref:x': '7',
    'socket:type2': '2',
    description: 'new',
    'socket:type2_cable': '1',
  },
  {
    amenity: 'charging_station',
    'socket:type2': '1',
    description: 'old',
    'socket:type2_cable:output': '22 kW',
    opening_hours: '24/7',
    'socket:type2_combo': 'yes',
  },
)

describe('per-key ticks', () => {
  test('changeable keys are exactly the missing and differing ones', () => {
    expect(changeableKeys(d).map((t) => t.key)).toEqual([
      'description',
      'ref:x',
      'socket:type2',
      'socket:type2_cable',
    ])
  })

  test('additions and non-surveyed corrections default on; surveyed conflicts default off', () => {
    // socket:type2_cable is a plain addition here: the candidate itself states both variants.
    expect(defaultSelection(d)).toEqual({
      description: true,
      'ref:x': true,
      'socket:type2': false,
      'socket:type2_cable': true,
    })
  })

  test('variant sockets default off', () => {
    const v = div({ 'socket:type2_cable': '1' }, { 'socket:type2': '1' })
    expect(defaultSelection(v)).toEqual({ 'socket:type2_cable': false })
  })

  test('an existing branch is kept unless ticked; a missing one is added', () => {
    const kept = div({ branch: 'Trakia 243 Burgas' }, { branch: 'FINES Тракия 243 ЕКО' })
    expect(defaultSelection(kept)).toEqual({ branch: false })
    expect(changesFor(kept, defaultSelection(kept))).toEqual({})
    const added = div({ branch: 'Gelemenovo' }, {})
    expect(changesFor(added, defaultSelection(added))).toEqual({ branch: 'Gelemenovo' })
  })

  test('changesFor applies only ticked keys', () => {
    expect(changesFor(d, defaultSelection(d))).toEqual({
      description: 'new',
      'ref:x': '7',
      'socket:type2_cable': '1',
    })
    expect(changesFor(d, { 'socket:type2': true })).toEqual({ 'socket:type2': '2' })
    expect(changesFor(d, { opening_hours: true, amenity: true })).toEqual({}) // not changeable
  })
})

describe('applyChanges never deletes', () => {
  test('keys only in OSM survive every change set', () => {
    const current = { amenity: 'charging_station', opening_hours: '24/7', note: 'surveyed' }
    const out = applyChanges(current, { fee: 'yes', amenity: 'charging_station' })
    expect(out).toEqual({
      amenity: 'charging_station',
      opening_hours: '24/7',
      note: 'surveyed',
      fee: 'yes',
    })
  })

  test('the input is not mutated', () => {
    const current = { a: '1' }
    applyChanges(current, { a: '2' })
    expect(current).toEqual({ a: '1' })
  })
})

describe('no-op detection', () => {
  test.each([
    [{}, false, true],
    [{ a: '1' }, false, true],
    [{ a: '2' }, false, false],
    [{ b: '1' }, false, false],
    [{}, true, false],
  ])('changes %j, move %s → noop %s', (changes, move, noop) => {
    expect(isNoopUpdate({ a: '1' }, changes, move)).toBe(noop)
  })
})
