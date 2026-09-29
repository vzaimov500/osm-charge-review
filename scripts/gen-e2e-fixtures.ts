/**
 * Deterministic synthetic fixtures for end-to-end tests: a 600-candidate queue
 * and a matching Overpass response. Synthetic on purpose — provider data may
 * not be redistributed. Run: npx tsx scripts/gen-e2e-fixtures.ts
 */
import { writeFileSync } from 'node:fs'

let seed = 42
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647

const N = 600
const features = []
const elements = []
for (let i = 1; i <= N; i++) {
  const lon = 22.5 + rnd() * 5.8
  const lat = 41.4 + rnd() * 2.6
  const sockets: Record<string, string> =
    rnd() < 0.8
      ? { 'socket:type2_combo': String(1 + Math.floor(rnd() * 3)) }
      : { 'socket:type2': '2' }
  features.push({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [Number(lon.toFixed(6)), Number(lat.toFixed(6))] },
    properties: {
      source_id: String(i),
      ref: String(i),
      tags: { ...sockets, access: 'yes', fee: 'yes' },
      label: `Station ${i}`,
      address: `Street ${i}, Town ${i % 37}`,
      ...(i % 25 === 0 ? { notes: 'restricted access in feed' } : {}),
    },
  })
  // ~70 % already mapped nearby, some linked by ref, some with the operator.
  const r = rnd()
  if (r < 0.7) {
    const d = rnd() * 0.0004
    const tags: Record<string, string> = { amenity: 'charging_station', ...sockets }
    if (r < 0.15) tags['ref:example'] = String(i)
    if (r < 0.5) tags.operator = 'Example Energy'
    if (r < 0.1) tags.fee = 'yes'
    elements.push({
      type: 'node',
      id: 9_000_000_000 + i,
      lat: Number((lat + d).toFixed(7)),
      lon: Number((lon + d).toFixed(7)),
      timestamp: '2024-05-01T10:00:00Z',
      version: 2,
      changeset: 150_000_000 + i,
      user: i % 3 ? 'mapper_a' : 'mapper_b',
      uid: 1000 + (i % 3),
      tags,
    })
  }
}

const queue = {
  type: 'FeatureCollection',
  metadata: {
    format_version: '1',
    dataset_id: 'e2e-example',
    dataset_name: 'E2E example stations',
    source_url: 'https://example.org/stations.geojson',
    licence: 'LicenseRef-pending',
    retrieved_at: '2026-09-28T20:00:00Z',
    adapter: { name: 'e2e-generator', version: '1.0.0' },
    ref_key: 'ref:example',
    default_tags: { amenity: 'charging_station', operator: 'Example Energy' },
  },
  features,
}
const overpass = {
  version: 0.6,
  generator: 'synthetic',
  osm3s: { timestamp_osm_base: '2026-09-28T22:00:00Z', copyright: 'synthetic test data' },
  elements,
}
writeFileSync(
  new URL('../test/fixtures/e2e/queue-600.json', import.meta.url),
  JSON.stringify(queue),
)
writeFileSync(
  new URL('../test/fixtures/e2e/overpass-600.json', import.meta.url),
  JSON.stringify(overpass),
)
console.log(`queue: ${features.length} features; overpass: ${elements.length} elements`)
