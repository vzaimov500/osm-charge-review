import { expect, test } from 'vitest'
import { seedCandidateFile, seedScenario } from '../../scripts/lib/seedScenario'
import { parseCandidateText } from '../../src/format'
import { classifyAll, DEFAULT_MATCH_CONFIG } from '../../src/match'
import type { OsmObject } from '../../src/osm/types'

// The seeded world must produce exactly the classes the scenario promises —
// this is what scripts/check-sandbox-seed.ts checks against the real sandbox.
test('each seeded case lands in its expected class', () => {
  const s = seedScenario()
  const r = parseCandidateText(JSON.stringify(seedCandidateFile(s, '2026-09-29T00:00:00Z')))
  if (!r.ok) throw new Error(r.issues.map((i) => i.message).join('\n'))
  const objects: OsmObject[] = s.stations.map((st, i) => ({
    osmType: 'node',
    osmId: 1000 + i,
    version: 1,
    lat: st.lat,
    lon: st.lon,
    tags: st.tags,
    lastEditUser: 'seed',
    lastEditUid: 1,
    lastEditAt: '2026-09-29T00:00:00Z',
    changeset: 1,
  }))
  const matches = classifyAll(r.dataset.candidates, objects, s.refKey, DEFAULT_MATCH_CONFIG)
  const got = Object.fromEntries(matches.map((m) => [m.sourceId, m.class]))
  const want = Object.fromEntries(s.candidates.map((c) => [c.sourceId, c.expect]))
  expect(got).toEqual(want)
  expect(s.stations.length).toBeGreaterThanOrEqual(18)
  expect(new Set(Object.values(want))).toEqual(
    new Set(['linked', 'probable', 'possible', 'lifecycle', 'none']),
  )
})
