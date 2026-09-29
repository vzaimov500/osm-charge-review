import { describe, expect, test } from 'vitest'
import { compareValues, looseForm, parsePowerW } from '../../../src/match'

describe('compareValues', () => {
  test.each([
    // identical / whitespace
    ['fee', 'yes', 'yes', 'equal'],
    ['fee', 'yes', ' yes ', 'equal'],
    ['description', 'a  b', 'a b', 'equal'],
    // enumerations are case-insensitive
    ['access', 'yes', 'Yes', 'equal'],
    ['socket:type2', '2', '02', 'equal'],
    // synonyms
    ['access', 'yes', 'public', 'equal'],
    ['access', 'yes', 'customers', 'different'],
    // numbers
    ['capacity', '2', '2.0', 'equal'],
    ['capacity', '2', '3', 'different'],
    // power
    ['socket:type2_combo:output', '22 kW', '22kW', 'equal'],
    ['socket:type2_combo:output', '22 kW', '22000 W', 'equal'],
    ['socket:type2_combo:output', '22 kW', '22', 'equal'],
    ['socket:type2_combo:output', '0.35 MW', '350 kW', 'equal'],
    ['socket:type2_combo:output', '7,4 kW', '7.4 kW', 'equal'],
    ['charging_station:output', '50 kW;22 kW', '22 kW;50 kW', 'equal'],
    ['socket:type2_combo:output', '50 kW', '22 kW', 'different'],
    ['socket:type2_combo:output', '50 kW', 'fast', 'different'],
    ['socket:type2_combo:output', '50 kW', '22 kW;50 kW', 'osm_more_specific'],
    ['socket:type2_combo:output', '180 kW', '120 kW; 180 kW', 'osm_more_specific'],
    ['socket:type2_combo:output', '120 kW', '120 kW; 180 kW', 'different'],
    ['socket:type2_combo:output', '50 kW;22 kW', '50 kW', 'different'],
    ['socket:type2_combo:output', '50 kW', '50 hp', 'different'],
    // lists
    ['payment:cards', 'visa;mastercard', 'mastercard; visa', 'equal'],
    ['payment:cards', 'visa;mastercard', 'visa', 'different'],
    // OSM holds a non-specific count
    ['socket:type2', '2', 'yes', 'refines'],
    ['capacity', '4', 'yes', 'refines'],
    ['socket:type2', '0', 'yes', 'different'],
    ['fee', 'no', 'yes', 'different'],
    // names: exact, but spelling variants are recognised
    ['operator', 'Fines Energy', 'FINES ENERGY', 'loose'],
    ['operator', 'Fines Energy', 'Fines-Energy', 'loose'],
    ['brand', 'Ениджи', 'ЕНИДЖИ', 'loose'],
    ['name', 'Café', 'Cafe', 'loose'],
    ['operator', 'Fines', 'Eldrive', 'different'],
    ['description', 'Abc', 'abc', 'different'],
  ])('%s: %j vs %j → %s', (key, a, b, expected) => {
    expect(compareValues(key, a, b)).toBe(expected)
  })
})

describe('parsePowerW', () => {
  test.each([
    ['22 kW', 22_000],
    ['22kw', 22_000],
    ['3.7 kW', 3_700],
    ['7,4 kW', 7_400],
    ['500 W', 500],
    ['1 MW', 1_000_000],
    ['11 kVA', 11_000],
    ['22', 22_000],
    ['fast', undefined],
    ['22 hp', undefined],
    ['', undefined],
  ])('%j → %j', (v, w) => expect(parsePowerW(v)).toBe(w))
})

test('looseForm strips case, accents, spaces and punctuation', () => {
  expect(looseForm(' Café-Bar, Sofia ')).toBe('cafebarsofia')
})
