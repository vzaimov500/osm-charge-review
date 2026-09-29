/**
 * Seed the OSM *sandbox* with the scenario in scripts/lib/seedScenario.ts
 * and write the matching candidate file.
 *
 *   npx tsx scripts/seed-sandbox.ts --dry-run            # print the osmChange, touch nothing
 *   OSM_SANDBOX_TOKEN=… npx tsx scripts/seed-sandbox.ts   # upload to the sandbox
 *
 * The token comes from signing in to the sandbox in the app (osm-auth stores it
 * in localStorage under "https://master.apis.dev.openstreetmap.orgoauth2_access_token").
 * This script can only ever talk to the sandbox.
 */
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  buildChangesetXml,
  buildOsmChange,
  parseDiffResult,
  type CreateItem,
} from '../src/osm/build/osmChange'
import { OsmApiClient, TARGETS } from '../src/osm/transport/api'
import { seedCandidateFile, seedScenario } from './lib/seedScenario'

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    out: { type: 'string', default: 'sandbox-seed.candidates.json' },
    contact: { type: 'string', default: process.env.SEED_CONTACT ?? '' },
  },
})

const SANDBOX = TARGETS.sandbox.apiUrl
if (SANDBOX !== 'https://master.apis.dev.openstreetmap.org')
  throw new Error('refusing: not the sandbox')
const UA = `osm-charge-review-seed/1.0 (+https://github.com/vzaimov500/osm-charge-review${args.contact ? `; ${args.contact}` : ''})`

const scenario = seedScenario()
const items: CreateItem[] = scenario.stations.map((s, i) => ({
  kind: 'create',
  sourceId: s.key,
  placeholderId: -(i + 1),
  lat: s.lat,
  lon: s.lon,
  tags: s.tags,
}))
writeFileSync(
  args.out,
  JSON.stringify(seedCandidateFile(scenario, new Date().toISOString()), null, 2),
)
console.error(
  `wrote ${scenario.candidates.length} candidates to ${args.out} (expected classes in each feature's notes)`,
)

if (args['dry-run']) {
  process.stdout.write(buildOsmChange(null, items, 'seed-sandbox'))
  process.exit(0)
}

const token = process.env.OSM_SANDBOX_TOKEN
if (!token) throw new Error('set OSM_SANDBOX_TOKEN (see the header of this file), or use --dry-run')

// Node may set a User-Agent: identify honestly.
const fetchWithUa: typeof fetch = (input, init = {}) =>
  fetch(input, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), 'User-Agent': UA },
  })
const api = new OsmApiClient({
  target: 'sandbox',
  apiUrl: SANDBOX,
  token: () => token,
  logger: (e) => console.error(`${e.method} ${e.url} → ${e.status}`),
  fetchImpl: fetchWithUa,
})

const me = await api.userDetails()
console.error(`signed in to the sandbox as ${me.displayName}`)
const cs = Number(
  await api.ok(
    'PUT',
    '/changeset/create',
    buildChangesetXml(
      {
        comment: 'osm-charge-review sandbox test seed',
        created_by: 'osm-charge-review seed-sandbox 1.0',
      },
      'seed-sandbox',
    ),
  ),
)
try {
  const diff = parseDiffResult(
    await api.ok('POST', `/changeset/${cs}/upload`, buildOsmChange(cs, items, 'seed-sandbox')),
  )
  console.error(`seeded ${diff.length} stations in changeset ${cs}`)
} finally {
  await api.ok('PUT', `/changeset/${cs}/close`).catch((e) => console.error(`close: ${String(e)}`))
}
