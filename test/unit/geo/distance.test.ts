import { describe, expect, test } from 'vitest'
import { bboxOf, distanceM, expandBBox, GridIndex } from '../../../src/geo/distance'

describe('distanceM', () => {
  test('one degree of latitude ≈ 111.2 km', () => {
    expect(distanceM({ lon: 0, lat: 0 }, { lon: 0, lat: 1 })).toBeCloseTo(111_195, -1)
  })
  test('Sofia → Plovdiv ≈ 132 km', () => {
    const d = distanceM({ lon: 23.3219, lat: 42.6977 }, { lon: 24.7453, lat: 42.1354 })
    expect(d / 1000).toBeGreaterThan(130)
    expect(d / 1000).toBeLessThan(134)
  })
  test('zero and symmetric', () => {
    const a = { lon: 23.3, lat: 42.7 }
    const b = { lon: 23.31, lat: 42.71 }
    expect(distanceM(a, a)).toBe(0)
    expect(distanceM(a, b)).toBeCloseTo(distanceM(b, a), 9)
  })
})

describe('bbox', () => {
  test('bboxOf and expandBBox', () => {
    expect(bboxOf([])).toBeUndefined()
    const b = bboxOf([
      { lon: 23, lat: 42 },
      { lon: 24, lat: 43 },
    ])!
    expect(b).toEqual({ minLon: 23, minLat: 42, maxLon: 24, maxLat: 43 })
    const e = expandBBox(b, 1000)
    expect(e.minLat).toBeCloseTo(42 - 0.009, 3)
    expect(e.minLon).toBeLessThan(23 - 0.009) // longitude degrees are shorter
  })
})

describe('GridIndex', () => {
  test('finds exactly the points within the radius, matching brute force', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const pts = Array.from({ length: 400 }, () => ({
      lon: 23.3 + rnd() * 0.02,
      lat: 42.69 + rnd() * 0.02,
    }))
    const idx = new GridIndex(pts, 50)
    for (const p of pts.slice(0, 50)) {
      for (const r of [5, 50, 150]) {
        const brute = pts.flatMap((q, i) => (distanceM(p, q) <= r ? [i] : [])).sort((a, b) => a - b)
        expect(idx.within(p, r).sort((a, b) => a - b)).toEqual(brute)
      }
    }
  })
})

test('bboxOf handles points in any order', () => {
  expect(
    bboxOf([
      { lon: 24, lat: 43 },
      { lon: 23, lat: 42 },
      { lon: 23.5, lat: 42.5 },
    ]),
  ).toEqual({ minLon: 23, minLat: 42, maxLon: 24, maxLat: 43 })
})
