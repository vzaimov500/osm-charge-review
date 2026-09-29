import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { buildStationQuery, LIFECYCLE_PREFIXES } from '../../../src/osm/build/overpassQuery'
import { OverpassParseError, parseOverpassJson } from '../../../src/osm/build/overpassParse'

const fixture = () =>
  JSON.parse(
    readFileSync(new URL('../../fixtures/overpass/synthetic-sofia.json', import.meta.url), 'utf8'),
  )

describe('buildStationQuery', () => {
  const q = buildStationQuery({
    bbox: { minLon: 22.3, minLat: 41.2, maxLon: 28.7, maxLat: 44.3 },
    refKey: 'ref:fines',
    identifier: 'osm-charge-review 1.2.3 https://example.org */ injected',
  })

  test('one query, global bbox in S,W,N,E order, json, meta + center', () => {
    expect(q).toContain('[out:json][timeout:120][bbox:41.200000,22.300000,44.300000,28.700000];')
    expect(q.trimEnd().endsWith('out center tags meta;')).toBe(true)
  })

  test('includes live, every lifecycle prefix, and the ref key', () => {
    expect(q).toContain('nwr["amenity"="charging_station"];')
    for (const p of LIFECYCLE_PREFIXES)
      expect(q).toContain(`nwr["${p}:amenity"="charging_station"];`)
    expect(q).toContain('nwr["ref:fines"];')
  })

  test('identifier comment cannot break out of the comment', () => {
    const first = q.split('\n')[0]!
    expect(first).toBe('/* osm-charge-review 1.2.3 https://example.org  injected */')
  })

  test('custom timeout', () => {
    expect(
      buildStationQuery({
        bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
        refKey: 'ref',
        identifier: 'x',
        timeoutS: 30,
      }),
    ).toContain('[timeout:30]')
  })
})

describe('parseOverpassJson', () => {
  test('parses nodes, ways and relations (centroid) with meta', () => {
    const { objects, timestampOsmBase } = parseOverpassJson(fixture())
    expect(timestampOsmBase).toBe('2026-09-28T22:00:00Z')
    expect(objects).toHaveLength(5)
    expect(objects[0]).toEqual({
      osmType: 'node',
      osmId: 1000000001,
      version: 3,
      lat: 42.6977,
      lon: 23.3219,
      tags: {
        amenity: 'charging_station',
        operator: 'Example Energy',
        'socket:type2_combo': '2',
        capacity: '2',
      },
      lastEditUser: 'surveyor_bg',
      lastEditUid: 101,
      lastEditAt: '2025-03-14T09:26:53Z',
      changeset: 160000001,
    })
    expect(objects[1]).toMatchObject({ osmType: 'way', lat: 42.1354, lon: 24.7453 })
    expect(objects[4]).toMatchObject({ osmType: 'relation', lat: 42.7 })
  })

  test('tolerates missing meta fields and tags', () => {
    const { objects, timestampOsmBase } = parseOverpassJson({
      elements: [{ type: 'node', id: 1, version: 1, lat: 1, lon: 2 }],
    })
    expect(objects[0]).toMatchObject({
      tags: {},
      lastEditUser: '',
      lastEditUid: 0,
      lastEditAt: '',
      changeset: 0,
    })
    expect(timestampOsmBase).toBeUndefined()
  })

  test.each([
    ['null', null, /not a JSON object/],
    [
      'runtime error remark',
      { elements: [], remark: 'runtime error: Query timed out' },
      /Overpass reported/,
    ],
    ['no elements', {}, /no elements/],
    ['unknown type', { elements: [{ type: 'area', id: 1 }] }, /unknown type/],
    ['way without center', { elements: [{ type: 'way', id: 1, version: 1 }] }, /out center/],
    ['no version', { elements: [{ type: 'node', id: 1, lat: 1, lon: 1 }] }, /meta/],
    [
      'numeric tag',
      { elements: [{ type: 'node', id: 1, version: 1, lat: 1, lon: 1, tags: { capacity: 2 } }] },
      /non-string/,
    ],
  ])('rejects %s', (_, data, msg) => {
    expect(() => parseOverpassJson(data)).toThrow(OverpassParseError)
    expect(() => parseOverpassJson(data)).toThrow(msg)
  })

  test('a harmless remark is not an error', () => {
    expect(parseOverpassJson({ elements: [], remark: 'note: nothing special' }).objects).toEqual([])
  })
})

describe('recorded response', () => {
  const recorded = JSON.parse(
    readFileSync(
      new URL('../../fixtures/overpass/recorded-sofia-centre.json', import.meta.url),
      'utf8',
    ),
  )

  test('parses every element of a real Overpass response', () => {
    const { objects, timestampOsmBase } = parseOverpassJson(recorded)
    expect(objects.length).toBe(recorded.elements.length)
    expect(objects.length).toBeGreaterThan(20)
    expect(timestampOsmBase).toBe('2026-09-28T22:32:46Z')
    for (const o of objects) {
      expect(o.version).toBeGreaterThan(0)
      expect(o.lastEditUser).not.toBe('')
      expect(Number.isNaN(Date.parse(o.lastEditAt))).toBe(false)
      expect(o.lat).toBeGreaterThan(42.6)
    }
  })

  test('ways in the real response get a centroid', () => {
    const { objects } = parseOverpassJson(recorded)
    const ways = objects.filter((o) => o.osmType === 'way')
    for (const w of ways) expect(w.lon).toBeGreaterThan(23.2)
  })
})

test('recorded lifecycle objects parse and are recognised as lifecycle', async () => {
  const { lifecyclePrefix } = await import('../../../src/match')
  const recorded = JSON.parse(
    readFileSync(
      new URL('../../fixtures/overpass/recorded-lifecycle.json', import.meta.url),
      'utf8',
    ),
  )
  const { objects } = parseOverpassJson(recorded)
  const prefixes = objects.map(lifecyclePrefix).filter(Boolean).sort()
  expect(prefixes).toEqual(['construction', 'disused', 'was', 'was'])
})
