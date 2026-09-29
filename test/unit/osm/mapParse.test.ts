import { describe, expect, test } from 'vitest'
import {
  bboxAreaDeg2,
  isStationObject,
  MapParseError,
  parseApiMapJson,
} from '../../../src/osm/build/mapParse'

const meta = { version: 2, user: 'u', uid: 7, timestamp: '2026-09-29T10:00:00Z', changeset: 99 }

describe('isStationObject (same selection as the Overpass query)', () => {
  test.each([
    [{ amenity: 'charging_station' }, true],
    [{ 'disused:amenity': 'charging_station' }, true],
    [{ 'construction:amenity': 'charging_station' }, true],
    [{ 'ref:example': '1', shop: 'car' }, true],
    [{ amenity: 'fuel' }, false],
    [{ 'disused:amenity': 'fuel' }, false],
  ])('%j → %s', (tags, want) => expect(isStationObject(tags, 'ref:example')).toBe(want))
})

describe('parseApiMapJson', () => {
  test('nodes, way centroid, relation from members; other objects ignored', () => {
    const r = parseApiMapJson(
      {
        elements: [
          { type: 'node', id: 1, lat: 42, lon: 23, tags: { amenity: 'charging_station' }, ...meta },
          { type: 'node', id: 2, lat: 42, lon: 23.002, version: 1 },
          { type: 'node', id: 3, lat: 42.002, lon: 23.002, version: 1 },
          { type: 'node', id: 4, lat: 42.5, lon: 23.5, version: 1, tags: { highway: 'bus_stop' } },
          {
            type: 'way',
            id: 10,
            nodes: [2, 3, 999],
            tags: { 'was:amenity': 'charging_station' },
            version: 3,
          },
          {
            type: 'relation',
            id: 20,
            members: [
              { type: 'node', ref: 1 },
              { type: 'way', ref: 10 },
              { type: 'relation', ref: 5 },
            ],
            tags: { 'ref:example': 'X' },
            version: 1,
          },
        ],
      },
      'ref:example',
    )
    expect(r.unpositioned).toEqual([])
    expect(r.objects.map((o) => `${o.osmType}/${o.osmId}`)).toEqual([
      'node/1',
      'way/10',
      'relation/20',
    ])
    expect(r.objects[0]).toEqual({
      osmType: 'node',
      osmId: 1,
      version: 2,
      lat: 42,
      lon: 23,
      tags: { amenity: 'charging_station' },
      lastEditUser: 'u',
      lastEditUid: 7,
      lastEditAt: '2026-09-29T10:00:00Z',
      changeset: 99,
    })
    expect(r.objects[1]).toMatchObject({ lon: 23.002, lastEditUser: '', changeset: 0 })
    expect(r.objects[1]!.lat).toBeCloseTo(42.001)
    expect(r.objects[2]!.lat).toBeCloseTo(42.0005)
    expect(r.objects[2]!.lon).toBeCloseTo(23.001)
  })

  test('stations without any known member position are reported, not guessed', () => {
    const r = parseApiMapJson(
      {
        elements: [
          { type: 'way', id: 10, tags: { amenity: 'charging_station' }, version: 1 },
          { type: 'relation', id: 20, tags: { amenity: 'charging_station' }, version: 1 },
          { type: 'node', id: 30, tags: { amenity: 'charging_station' }, version: 1 },
        ],
      },
      'ref:x',
    )
    expect(r.objects).toEqual([])
    expect(r.unpositioned).toEqual(['way/10', 'relation/20', 'node/30'])
  })

  test('malformed responses are errors', () => {
    expect(() => parseApiMapJson(null, 'ref:x')).toThrow(MapParseError)
    expect(() => parseApiMapJson({}, 'ref:x')).toThrow(/no elements/)
    expect(() => parseApiMapJson({ elements: [{ type: 'area', id: 1 }] }, 'ref:x')).toThrow(
      /unknown type area/,
    )
  })

  test('bbox area', () => {
    expect(bboxAreaDeg2({ minLon: 23, minLat: 42, maxLon: 23.5, maxLat: 42.5 })).toBe(0.25)
  })
})
