/**
 * Read-back verification and revert planning. Pure: compares
 * what the server now holds with what the tool intended.
 */
import type { OsmType } from '../types'
import type { ApiElement, DeleteItem, RestoreItem } from './osmChange'

// Structural shapes of the stored batch item and snapshot (declared here so
// this pure module does not depend on the storage layer).
export interface UploadedItem {
  sourceId: string
  kind: 'create' | 'modify'
  lat: number
  lon: number
  tags: Record<string, string>
  move?: boolean
  result?: { status: string; osmType?: OsmType; osmId?: number; version?: number }
}
export interface Snapshot {
  tags: Record<string, string>
  lat?: number
  lon?: number
}

export type VerifyState = 'match' | 'partial' | 'mismatch' | 'missing'

export interface VerifyResult {
  sourceId: string
  object: string
  state: VerifyState
  /** Human-readable differences (empty for match). */
  differences: string[]
}

const sameCoord = (a: number, b: number) => Math.abs(a - b) < 5e-8

function diffTags(expected: Record<string, string>, actual: Record<string, string>): string[] {
  const out: string[] = []
  for (const k of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (expected[k] !== actual[k])
      out.push(`${k}: expected ${expected[k] ?? '(absent)'}, found ${actual[k] ?? '(absent)'}`)
  }
  return out.sort()
}

/**
 * Compare one uploaded item with the object now on the server.
 * - match: exactly what was intended.
 * - partial: our changes are present, but other keys differ (someone edited since).
 * - mismatch: an intended value is not there.
 * - missing: the object is gone.
 */
export function verifyItem(
  item: UploadedItem,
  current: ApiElement | undefined,
  snapshot: Snapshot | undefined,
): VerifyResult {
  const r = item.result!
  const object = `${r.osmType}/${r.osmId}`
  const res = (state: VerifyState, differences: string[] = []): VerifyResult => ({
    sourceId: item.sourceId,
    object,
    state,
    differences,
  })
  if (!current || current.visible === false) return res('missing', ['object not found or deleted'])

  const ours = item.tags
  const oursDiff = Object.keys(ours)
    .filter((k) => current.tags[k] !== ours[k])
    .map((k) => `${k}: expected ${ours[k]}, found ${current.tags[k] ?? '(absent)'}`)
  if (current.type === 'node') {
    const wantPos =
      item.kind === 'create' || item.move
        ? { lat: item.lat, lon: item.lon }
        : snapshot
          ? { lat: snapshot.lat!, lon: snapshot.lon! }
          : undefined
    if (wantPos && (!sameCoord(current.lat, wantPos.lat) || !sameCoord(current.lon, wantPos.lon))) {
      oursDiff.push(
        `position: expected ${wantPos.lat},${wantPos.lon}, found ${current.lat},${current.lon}`,
      )
    }
  }
  if (oursDiff.length > 0) return res('mismatch', oursDiff)

  const expected = item.kind === 'create' ? ours : { ...(snapshot?.tags ?? {}), ...ours }
  const rest = diffTags(expected, current.tags)
  if (rest.length === 0 && current.version === r.version) return res('match')
  return res(
    'partial',
    rest.length ? rest : [`version ${current.version} (uploaded as ${r.version}): edited since`],
  )
}

export interface RevertPlan {
  items: (RestoreItem | DeleteItem)[]
  /** Objects edited by someone else since the batch: never steamrolled. */
  manual: { sourceId: string; object: string; reason: string }[]
}

/**
 * Plan a revert of a batch: restore snapshot tags on modified objects and
 * delete objects the batch created — only where nobody has edited them since.
 */
export function planRevert(
  items: readonly UploadedItem[],
  current: ReadonlyMap<string, ApiElement>,
  snapshots: ReadonlyMap<string, Snapshot>,
): RevertPlan {
  const plan: RevertPlan = { items: [], manual: [] }
  for (const it of items) {
    const r = it.result
    if (r?.status !== 'ok') continue
    const object = `${r.osmType}/${r.osmId}`
    const cur = current.get(object)
    if (!cur || cur.visible === false) {
      plan.manual.push({ sourceId: it.sourceId, object, reason: 'already deleted' })
      continue
    }
    if (cur.version !== r.version) {
      plan.manual.push({
        sourceId: it.sourceId,
        object,
        reason: `edited since the batch (version ${cur.version}, batch wrote ${r.version})`,
      })
      continue
    }
    if (it.kind === 'create') {
      plan.items.push({ kind: 'delete', sourceId: it.sourceId, current: cur })
      continue
    }
    const snap = snapshots.get(object)
    if (!snap) {
      plan.manual.push({ sourceId: it.sourceId, object, reason: 'no snapshot recorded' })
      continue
    }
    const restore: RestoreItem = {
      kind: 'restore',
      sourceId: it.sourceId,
      current: cur,
      tags: { ...snap.tags },
    }
    if (snap.lat !== undefined && snap.lon !== undefined)
      restore.position = { lat: snap.lat, lon: snap.lon }
    plan.items.push(restore)
  }
  return plan
}
