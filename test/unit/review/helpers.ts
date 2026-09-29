import { classifyAll, DEFAULT_MATCH_CONFIG, type MatchConfig } from '../../../src/match'
import { osmKey, type OsmObject } from '../../../src/osm/types'
import { buildRow, type Decision, type RowModel } from '../../../src/review'
import { cand, obj } from '../match/helpers'

export { cand, obj }
export const NOW = Date.parse('2026-09-29T00:00:00Z')
export const REF = 'ref:example'

/** Build rows for candidates against objects, as the app would. */
export function rows(
  cands: ReturnType<typeof cand>[],
  objects: OsmObject[],
  decisions: Record<string, Decision> = {},
  cfg: MatchConfig = DEFAULT_MATCH_CONFIG,
): RowModel[] {
  const matches = classifyAll(cands, objects, REF, cfg)
  const objectsByKey = new Map(objects.map((o) => [osmKey(o), o]))
  return cands.map((c, i) =>
    buildRow(c, matches[i]!, decisions[c.sourceId], { objectsByKey, cfg, now: NOW }),
  )
}

export const decision = (over: Partial<Decision> = {}): Decision => ({
  action: 'skip',
  decidedAt: '2026-09-28T10:00:00Z',
  contentHash: 'h',
  superseded: false,
  ...over,
})
