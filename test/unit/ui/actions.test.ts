import { expect, test } from 'vitest'
import { validateDecision, type Decision, type RowModel } from '../../../src/review'
import { POSITION_FIXME } from '../../../src/review'
import { add, addOptions, pickTarget, setAddOptions, shownTarget } from '../../../src/ui/actions'
import { IMAGERY, OSM_TILES, resolveTiles } from '../../../src/ui/imagery'
import { osmObjectUrl, osmUrl } from '../../../src/ui/format'
import type { AppState } from '../../../src/ui/state.svelte'
import { cand, obj, rows } from '../review/helpers'

/** Just enough of AppState for the actions: decisions are validated and kept in a map. */
function fakeApp() {
  const decisions: Record<string, Decision> = {}
  const app = {
    pickedTarget: null as AppState['pickedTarget'],
    addDraft: null as AppState['addDraft'],
    async decide(
      row: RowModel,
      d: Omit<Decision, 'decidedAt' | 'contentHash' | 'superseded'> | null,
    ) {
      if (d === null) {
        delete decisions[row.candidate.sourceId]
        return []
      }
      const full = { ...d, decidedAt: '', contentHash: 'h', superseded: false }
      const problems = validateDecision(row, full)
      if (problems.length === 0) decisions[row.candidate.sourceId] = full
      return problems
    },
  }
  return { app: app as unknown as AppState, decisions }
}

test('picking the already-correct object withdraws an Update on another and shows that object', async () => {
  const c = cand()
  const linked = obj(0, { ...c.tags }) // same ref and tags: nothing to change
  const other = obj(50, { amenity: 'charging_station' })
  const { app, decisions } = fakeApp()
  const row = () => rows([c], [linked, other], decisions)[0]!
  expect(row().targets).toHaveLength(2)

  expect(
    await pickTarget(
      app,
      row(),
      row().targets.find((t) => t.object === other)!,
    ),
  ).toEqual([])
  expect(decisions[c.sourceId]?.target?.osmId).toBe(other.osmId)
  expect(shownTarget(app, row())?.object.osmId).toBe(other.osmId)

  const back = row().targets.find((t) => t.object === linked)!
  expect(back.divergence.updateNeeded).toBe(false)
  expect(await pickTarget(app, row(), back)).toEqual([])
  expect(decisions[c.sourceId]).toBeUndefined() // the Update on the other object is gone
  expect(shownTarget(app, row())?.object.osmId).toBe(linked.osmId) // and its tags are shown
})

test('a pick on another station is ignored; without a pick the decision or suggestion shows', async () => {
  const c = cand()
  const near = obj(5, { amenity: 'charging_station' })
  const { app } = fakeApp()
  const r = rows([c], [near])[0]!
  app.pickedTarget = { sourceId: 'elsewhere', key: `node/${near.osmId}` }
  expect(shownTarget(app, r)).toBe(r.suggested)
})

test('links open on the website of the selected environment', () => {
  const sandbox = 'https://master.apis.dev.openstreetmap.org'
  expect(osmObjectUrl('node', 7)).toBe('https://www.openstreetmap.org/node/7')
  expect(osmObjectUrl('node', 7, sandbox)).toBe(`${sandbox}/node/7`)
  expect(osmUrl(42.5, 23.25, sandbox)).toMatch(
    /^https:\/\/master\.apis\.dev\.openstreetmap\.org\/\?mlat=/,
  )
})

test('a position and a fixme set before Add are used by Add; afterwards they change the saved Add', async () => {
  const c = cand()
  const { app, decisions } = fakeApp()
  const row = () => rows([c], [], decisions)[0]!
  const spot = { lat: c.lat + 0.0002, lon: c.lon + 0.0002 }

  // Nothing in OSM nearby: flagged until the reviewer has checked the place.
  expect(addOptions(app, row())).toEqual({ fixme: true })
  await setAddOptions(app, row(), { fixme: false })
  expect(addOptions(app, row())).toEqual({ fixme: false })
  await setAddOptions(app, row(), { position: spot })
  await setAddOptions(app, row(), { fixme: true })
  expect(decisions[c.sourceId]).toBeUndefined() // nothing is decided by dragging
  expect(addOptions(app, row())).toEqual({ position: spot, fixme: true })

  expect(await add(app, row())).toEqual([])
  expect(decisions[c.sourceId]).toMatchObject({
    action: 'add',
    position: spot,
    tags: { ...c.tags, fixme: POSITION_FIXME },
  })

  await setAddOptions(app, row(), { fixme: false })
  expect(decisions[c.sourceId]!.tags).toEqual(c.tags)
  expect(decisions[c.sourceId]!.position).toEqual(spot)
  await setAddOptions(app, row(), { position: null })
  expect(decisions[c.sourceId]!.position).toBeUndefined()
  expect(addOptions(app, row())).toEqual({ fixme: false }) // the saved Add, not the default
})

test('what was set for one station does not leak to another; too far is refused', async () => {
  const [a, b] = [cand(), cand()]
  const { app, decisions } = fakeApp()
  const [ra, rb] = rows([a, b], [], decisions)
  await setAddOptions(app, ra!, { fixme: false })
  expect(addOptions(app, rb!)).toEqual({ fixme: true })
  expect(
    await add(app, rb!, { fixme: false, position: { lat: b.lat + 0.01, lon: b.lon } }),
  ).toEqual(['position_too_far'])
})

test('imagery: a layer that needs a token is unavailable without one', () => {
  const mapbox = IMAGERY.find((s) => s.needsToken)!
  expect(resolveTiles(mapbox, '  ')).toBeUndefined()
  expect(resolveTiles(mapbox, ' pk.a b ')!.url).toContain('access_token=pk.a%20b')
  expect(resolveTiles(OSM_TILES, '')).toBe(OSM_TILES)
  expect(IMAGERY.map((s) => s.id)).toEqual(['maf', 'esri', 'mapbox'])
})

test('a station with something in OSM nearby is not flagged by default', () => {
  const c = cand()
  const { app } = fakeApp()
  const [r] = rows([c], [obj(80, { amenity: 'charging_station' })])
  expect(r!.targets.length).toBeGreaterThan(0)
  expect(addOptions(app, r!)).toEqual({ fixme: false })
})
