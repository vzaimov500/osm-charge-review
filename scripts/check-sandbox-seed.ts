/**
 * Sandbox testing: re-fetch the seeded sandbox area and check that every seed
 * candidate lands in its expected class (from each feature's notes).
 *
 *   npx tsx scripts/check-sandbox-seed.ts [sandbox-seed.candidates.json]
 *
 * One read-only request to the sandbox API; no sign-in needed. Exits 1 on any miss.
 */
import { readFileSync } from 'node:fs'
import { bboxOf, expandBBox } from '../src/geo/distance'
import { parseCandidateText } from '../src/format'
import { classifyAll, DEFAULT_MATCH_CONFIG } from '../src/match'
import { parseApiMapJson } from '../src/osm/build/mapParse'
import { OsmApiClient, TARGETS } from '../src/osm/transport/api'

const file = process.argv[2] ?? 'sandbox-seed.candidates.json'
const parsed = parseCandidateText(readFileSync(file, 'utf8'))
if (!parsed.ok) throw new Error(`${file}: ${parsed.issues.map((i) => i.message).join('; ')}`)
const { info, candidates } = parsed.dataset

const UA = 'osm-charge-review-seed-check/1.0 (sandbox testing protocol)'
const api = new OsmApiClient({
  target: 'sandbox',
  apiUrl: TARGETS.sandbox.apiUrl,
  token: () => null,
  logger: (e) => console.error(`${e.method} ${e.url} → ${e.status}`),
  fetchImpl: (input, init = {}) =>
    fetch(input, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), 'User-Agent': UA },
      signal: AbortSignal.timeout(30_000),
    }),
})
// The app's margin (stationCache BBOX_MARGIN_M; not importable here: it needs Vite's defines).
const box = expandBBox(bboxOf(candidates)!, 1_000)
const { objects, unpositioned } = parseApiMapJson(await api.map(box), info.ref_key)
if (unpositioned.length) console.error(`without a position: ${unpositioned.join(', ')}`)

const matches = new Map(
  classifyAll(candidates, objects, info.ref_key, DEFAULT_MATCH_CONFIG).map((m) => [m.sourceId, m]),
)
let misses = 0
for (const c of candidates) {
  const want = /expected class: (\w+)/.exec(c.notes ?? '')?.[1]
  const got = matches.get(c.sourceId)!.class
  if (got !== want) misses++
  console.log(
    `${got === want ? 'ok  ' : 'MISS'} ${c.sourceId.padEnd(16)} expected ${want} got ${got}`,
  )
}
console.log(`${candidates.length - misses}/${candidates.length} as expected`)
process.exit(misses ? 1 : 0)
