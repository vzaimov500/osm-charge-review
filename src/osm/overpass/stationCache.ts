import { expandBBox, type BBox } from '../../geo/distance'
import { hash53 } from '../../format/canonical'
import { appendEvent, type DB, type OsmObjectRecord } from '../../store/db'
import { CREATED_BY, TOOL_URL } from '../../version'
import { buildStationQuery } from '../build/overpassQuery'
import { bboxAreaDeg2, MAX_MAP_AREA_DEG2, parseApiMapJson } from '../build/mapParse'
import { parseOverpassJson } from '../build/overpassParse'
import type { OsmObject } from '../types'

/** Do not re-query within this window unless forced. */
export const CACHE_WINDOW_MS = 30 * 60_000
/** Margin around the dataset bbox so candidates at the edge see their neighbours. */
export const BBOX_MARGIN_M = 1_000

export interface LoadStationsOptions {
  datasetId: string
  /** Bounding box of the dataset's candidates. */
  bbox: BBox
  refKey: string
  force?: boolean
  now?: () => number
  /** Runs the query and returns the parsed JSON (see transport/overpass.ts). */
  run: (query: string) => Promise<unknown>
  endpoint: string
  /**
   * Read the sandbox instead of Overpass (which mirrors live OSM only): the
   * API's map call for the area. `endpoint` then names the sandbox API.
   */
  sandboxMap?: (bbox: BBox) => Promise<unknown>
}

export type StationSource = 'overpass' | 'sandbox'
export const stationsMetaKey = (source: StationSource, datasetId: string): string =>
  `${source}:stations:${datasetId}`

export class SandboxAreaError extends Error {
  override name = 'SandboxAreaError'
}

export interface LoadStationsResult {
  objects: OsmObject[]
  source: 'cache' | 'network'
  fetchedAt: string
}

/**
 * One Overpass query per dataset (or one sandbox map call), cached in
 * IndexedDB. A second call inside the cache window with the same query makes
 * no request.
 */
export async function loadStations(db: DB, o: LoadStationsOptions): Promise<LoadStationsResult> {
  const now = o.now ?? Date.now
  const box = expandBBox(o.bbox, BBOX_MARGIN_M)
  const query = buildStationQuery({
    bbox: box,
    refKey: o.refKey,
    identifier: `${CREATED_BY} ${TOOL_URL}`,
  })
  const source: StationSource = o.sandboxMap ? 'sandbox' : 'overpass'
  // The comment line carries the tool version; it must not invalidate the cache.
  const queryHash = o.sandboxMap
    ? hash53(`sandbox ${JSON.stringify(box)} ${o.refKey}`)
    : hash53(query.split('\n').slice(1).join('\n'))
  const metaKey = stationsMetaKey(source, o.datasetId)
  const meta = await db.get('fetch_meta', metaKey)

  if (
    !o.force &&
    meta &&
    meta.queryHash === queryHash &&
    now() - Date.parse(meta.fetchedAt) < CACHE_WINDOW_MS
  ) {
    const rows = await db.getAllFromIndex('osm_object', 'datasetId', o.datasetId)
    return { objects: rows.map(stripRecord), source: 'cache', fetchedAt: meta.fetchedAt }
  }

  let objects: OsmObject[]
  let timestampOsmBase: string | undefined
  let unpositioned: string[] = []
  if (o.sandboxMap) {
    const area = bboxAreaDeg2(box)
    if (area > MAX_MAP_AREA_DEG2)
      throw new SandboxAreaError(
        `This dataset covers ${area.toFixed(2)} square degrees; the sandbox API serves at most ${MAX_MAP_AREA_DEG2}. Use a small test dataset (such as the seed file) with the sandbox.`,
      )
    ;({ objects, unpositioned } = parseApiMapJson(await o.sandboxMap(box), o.refKey))
  } else {
    ;({ objects, timestampOsmBase } = parseOverpassJson(await o.run(query)))
  }
  const fetchedAt = new Date(now()).toISOString()

  // Replace this dataset's snapshot of OSM atomically.
  const tx = db.transaction(['osm_object', 'fetch_meta'], 'readwrite')
  const store = tx.objectStore('osm_object')
  for (const key of await store.index('datasetId').getAllKeys(o.datasetId)) await store.delete(key)
  for (const obj of objects) await store.put({ ...obj, datasetId: o.datasetId, fetchedAt })
  // The other source's snapshot is gone now: never serve it from cache again.
  await tx
    .objectStore('fetch_meta')
    .delete(stationsMetaKey(source === 'sandbox' ? 'overpass' : 'sandbox', o.datasetId))
  const newMeta = {
    key: metaKey,
    fetchedAt,
    queryHash,
    endpoint: o.endpoint,
    count: objects.length,
  }
  await tx
    .objectStore('fetch_meta')
    .put(timestampOsmBase ? { ...newMeta, timestampOsmBase } : newMeta)
  await tx.done

  await appendEvent(db, {
    at: fetchedAt,
    type: 'osm_fetch',
    datasetId: o.datasetId,
    data: {
      source,
      endpoint: o.endpoint,
      count: objects.length,
      timestampOsmBase,
      forced: !!o.force,
      ...(unpositioned.length ? { unpositioned } : {}),
    },
  })
  return { objects, source: 'network', fetchedAt }
}

function stripRecord(r: OsmObjectRecord): OsmObject {
  const { datasetId: _d, fetchedAt: _f, ...o } = r
  return o
}
