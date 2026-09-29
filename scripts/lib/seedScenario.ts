/**
 * The sandbox seeding scenario: deliberately tricky existing
 * stations, and the provider file that should be reviewed against them. Pure
 * and deterministic, so every run seeds the same world.
 */
import { EARTH_RADIUS_M } from '../../src/geo/distance'

export interface SeedStation {
  key: string
  lat: number
  lon: number
  tags: Record<string, string>
  /** What the matcher should say about the paired candidate. */
  expect: 'linked' | 'probable' | 'possible' | 'lifecycle' | 'none'
}

export interface SeedCandidate {
  sourceId: string
  lat: number
  lon: number
  tags: Record<string, string>
  label: string
  expect: SeedStation['expect']
}

const REF = 'ref:seedtest'
const OP = 'Seed Energy'
const deg = (m: number, lat: number) => ({
  dLat: m / ((Math.PI * EARTH_RADIUS_M) / 180),
  dLon: m / ((Math.PI * EARTH_RADIUS_M) / 180) / Math.cos((lat * Math.PI) / 180),
})

/** A grid of sites 500 m apart around `origin`; each site holds one scenario. */
export function seedScenario(origin = { lat: 42.6977, lon: 23.3219 }) {
  const stations: SeedStation[] = []
  const candidates: SeedCandidate[] = []
  let n = 0
  const site = () => {
    const i = n++
    const { dLat, dLon } = deg(500, origin.lat)
    return { lat: origin.lat + Math.floor(i / 5) * dLat, lon: origin.lon + (i % 5) * dLon }
  }
  const offset = (p: { lat: number; lon: number }, m: number) => {
    const { dLon } = deg(m, p.lat)
    return { lat: p.lat, lon: p.lon + dLon }
  }
  const base = { amenity: 'charging_station', 'socket:type2_combo': '2' }
  const add = (
    key: string,
    expect: SeedStation['expect'],
    osm: Record<string, string> | null,
    candOffsetM: number,
    candTags: Record<string, string> = {},
  ) => {
    const p = site()
    if (osm) stations.push({ key, ...p, tags: osm, expect })
    const c = offset(p, candOffsetM)
    candidates.push({
      sourceId: key,
      ...c,
      label: `Seed ${key}`,
      tags: { ...base, operator: OP, ...candTags },
      expect,
    })
  }

  // Correct ref: linked, whatever the distance.
  for (const k of ['ref-exact', 'ref-far'])
    add(k, 'linked', { ...base, operator: OP, [REF]: k }, k === 'ref-far' ? 400 : 0)
  // Same operator, 30–45 m off: probable.
  for (const [k, m] of [
    ['near-30', 30],
    ['near-45', 45],
  ] as const)
    add(k, 'probable', { ...base, operator: OP }, m)
  // 60–80 m off: possible (outside the probable radius).
  for (const [k, m] of [
    ['off-60', 60],
    ['off-80', 80],
  ] as const)
    add(k, 'possible', { ...base, operator: OP }, m)
  // Misspelled operator: still probable (spelling variant), flagged.
  add('spelling', 'probable', { ...base, operator: 'SEED ENERGY' }, 10)
  // No operator on the OSM object: possible.
  for (const k of ['no-op-1', 'no-op-2']) add(k, 'possible', { ...base }, 12)
  // Different operator close by: possible, flagged operator_differs.
  add('other-op', 'possible', { ...base, operator: 'Other Power' }, 15)
  // Lifecycle prefixes: someone marked it gone or not yet built.
  for (const p of ['disused', 'was', 'proposed'] as const)
    add(`life-${p}`, 'lifecycle', { [`${p}:amenity`]: 'charging_station', operator: OP }, 10)
  // Conflicting values on surveyed keys.
  add(
    'conflict',
    'probable',
    { ...base, operator: OP, 'socket:type2_combo': '4', opening_hours: 'Mo-Fr 08:00-18:00' },
    5,
    { opening_hours: '24/7' },
  )
  // Socket variant (cable attached or not).
  add(
    'variant',
    'probable',
    { amenity: 'charging_station', operator: OP, 'socket:type2': '2' },
    5,
    { 'socket:type2_cable': '2' },
  )
  // Linked but 40 m apart: the `moved` flag, never an automatic move.
  add('moved', 'linked', { ...base, operator: OP, [REF]: 'moved' }, 40)
  // Recently surveyed: check_date outranks the provider.
  add(
    'surveyed',
    'probable',
    { ...base, operator: OP, check_date: '2026-06-01', capacity: '2' },
    8,
    { capacity: '4' },
  )
  // Already correct: a linked no-op.
  add('noop', 'linked', { ...base, operator: OP, [REF]: 'noop' }, 0)
  // Nothing in OSM: a new station.
  for (const k of ['new-1', 'new-2', 'new-3']) add(k, 'none', null, 0)

  for (const c of candidates) c.tags[REF] = c.sourceId
  return { stations, candidates, refKey: REF }
}

/** The candidate file for the review tool (interchange format v1). */
export function seedCandidateFile(s: ReturnType<typeof seedScenario>, retrievedAt: string) {
  return {
    type: 'FeatureCollection',
    metadata: {
      format_version: '1',
      dataset_id: 'sandbox-seed',
      dataset_name: 'Sandbox seed scenario',
      source_url: 'https://example.org/sandbox-seed',
      licence: 'CC0-1.0',
      retrieved_at: retrievedAt,
      adapter: { name: 'seed-sandbox', version: '1.0.0' },
      ref_key: s.refKey,
    },
    features: s.candidates.map((c) => {
      const { [s.refKey]: _r, ...tags } = c.tags
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [Number(c.lon.toFixed(7)), Number(c.lat.toFixed(7))],
        },
        properties: {
          source_id: c.sourceId,
          ref: c.sourceId,
          tags,
          label: c.label,
          notes: `expected class: ${c.expect}`,
        },
      }
    }),
  }
}
