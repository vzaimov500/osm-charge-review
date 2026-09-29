import { describe, expect, test } from 'vitest'
import { buildRegionQuery, parseRegionResponse } from '../../../src/osm/build/regionQuery'

describe('buildRegionQuery', () => {
  const q = buildRegionQuery(
    [
      { lon: 23.3219, lat: 42.6977 },
      { lon: 27.9147, lat: 43.2141 },
    ],
    { identifier: 'osm-charge-review 1.0 */x' },
  )
  test('one request: a marker and an is_in per point, tags only', () => {
    const lines = q.split('\n')
    expect(lines[0]).toBe('/* osm-charge-review 1.0 x */')
    expect(lines[1]).toBe('[out:json][timeout:120];')
    expect(lines[2]).toBe('make m idx="0"; out;')
    expect(lines[3]).toBe(
      'is_in(42.697700,23.321900)->.a; area.a["boundary"="administrative"]["admin_level"]; out tags;',
    )
    expect(lines[4]).toBe('make m idx="1"; out;')
    expect(q).not.toContain('geom')
  })
  test('custom timeout', () => {
    expect(buildRegionQuery([], { identifier: 'x', timeoutS: 30 })).toContain('[timeout:30]')
  })
})

describe('parseRegionResponse', () => {
  const area = (level: string, name: string, extra: Record<string, string> = {}) => ({
    type: 'area',
    tags: { admin_level: level, name, boundary: 'administrative', ...extra },
  })
  const m = (i: number) => ({ type: 'm', tags: { idx: String(i) } })

  test('picks the most specific level at or above the maximum, per point', () => {
    const data = {
      elements: [
        m(0),
        area('2', 'България'),
        area('6', 'София-град'),
        area('8', 'Столична'),
        area('10', 'Младост'),
        m(1),
        area('4', 'Region'),
        area('6', 'Варна'),
        m(2),
      ],
    }
    expect(parseRegionResponse(data, 3)).toEqual(['Столична', 'Варна', undefined])
    expect(parseRegionResponse(data, 3, 6)).toEqual(['София-град', 'Варна', undefined])
  })

  test('order of areas in the response does not matter', () => {
    const data = {
      elements: [m(0), area('8', 'Столична'), area('6', 'София-град'), area('2', 'България')],
    }
    expect(parseRegionResponse(data, 1)).toEqual(['Столична'])
  })

  test('prefers a localised name when asked, falling back to name', () => {
    const data = {
      elements: [m(0), area('8', 'Столична', { 'name:en': 'Stolichna' }), m(1), area('8', 'Варна')],
    }
    expect(parseRegionResponse(data, 2, 8, 'name:en')).toEqual(['Stolichna', 'Варна'])
  })

  test('ignores malformed input and out-of-range markers', () => {
    expect(parseRegionResponse(null, 2)).toEqual([undefined, undefined])
    expect(parseRegionResponse({}, 1)).toEqual([undefined])
    const data = {
      elements: [
        area('8', 'before any marker'),
        { type: 'm' },
        area('8', 'bad marker'),
        m(5),
        area('8', 'beyond count'),
        m(0),
        { type: 'area', tags: { admin_level: 'x', name: 'n' } },
        { type: 'area', tags: { admin_level: '8' } },
        { type: 'area' },
        { type: 'node', tags: { admin_level: '8', name: 'node' } },
      ],
    }
    expect(parseRegionResponse(data, 1)).toEqual([undefined])
  })
})
