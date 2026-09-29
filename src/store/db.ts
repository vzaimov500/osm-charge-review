import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { NetworkLogEntry } from '../audit/networkLog'
import type { Candidate, DatasetInfo } from '../format'
import type { OsmObject } from '../osm/types'

/**
 * IndexedDB layout. Everything is scoped by `datasetId` so several
 * datasets coexist. Record shapes for later phases are declared here up front;
 * adding an index or store requires bumping DB_VERSION with a migration.
 */
export const DB_NAME = 'osm-charge-review'
export const DB_VERSION = 1

export type ApiTarget = 'sandbox' | 'live'

export interface DatasetRecord {
  datasetId: string
  info: DatasetInfo
  importedAt: string
  fileHash: string
}

export interface CandidateRecord extends Candidate {
  datasetId: string
  firstSeen: string
  lastSeen: string
  disappeared: boolean
}

export interface OsmObjectRecord extends OsmObject {
  datasetId: string
  fetchedAt: string
}

export interface MatchRecord {
  datasetId: string
  sourceId: string
  osmType: OsmObject['osmType']
  osmId: number
  distanceM: number
  class: string
  reasons: string[]
}

export interface DecisionRecord {
  datasetId: string
  sourceId: string
  action: 'add' | 'update' | 'reject' | 'skip'
  targetOsmType?: OsmObject['osmType']
  targetOsmId?: number
  targetVersion?: number
  reasonCode?: string
  note?: string
  /** Update: keys to set (additive). Add: the full tags to create. */
  tags?: Record<string, string>
  /** Update: move the object to the candidate position (explicit, never default). */
  move?: boolean
  decidedAt: string
  /** contentHash of the candidate when decided; differs ⇒ superseded. */
  contentHash: string
  superseded: boolean
  /** Why it was superseded: the provider record changed, or the OSM object changed upstream. */
  supersededBy?: 'source' | 'upstream'
  /** Set once the change reached the API in this batch. */
  uploadedBatchId?: string
}

export interface SnapshotRecord {
  batchId: string
  osmType: OsmObject['osmType']
  osmId: number
  version: number
  tags: Record<string, string>
  lat?: number
  lon?: number
}

export interface BatchItemResult {
  status: 'ok' | 'conflict' | 'gone' | 'noop'
  osmType?: OsmObject['osmType']
  osmId?: number
  version?: number
  message?: string
}

export interface BatchItem {
  sourceId: string
  kind: 'create' | 'modify'
  /** Candidate position. */
  lat: number
  lon: number
  /** Create: full tags. Modify: keys to set. */
  tags: Record<string, string>
  target?: { osmType: OsmObject['osmType']; osmId: number }
  targetVersion?: number
  move?: boolean
  placeholderId?: number
  result?: BatchItemResult
}

/** Where an in-flight batch got to; recovery starts from here. */
export type BatchStep = 'revalidate' | 'open' | 'upload' | 'close' | 'verify' | 'done'

export interface BatchRecord {
  id: string
  datasetId: string
  apiTarget: ApiTarget
  changesetId?: number
  /** A batch stays in_flight until read-back verification passes. */
  status: 'draft' | 'in_flight' | 'verified' | 'failed' | 'reverted'
  step?: BatchStep
  comment: string
  changesetTags?: Record<string, string>
  createdAt: string
  sourceIds: string[]
  items: BatchItem[]
  /** When the operator last produced a dry-run .osc of this batch (required before live uploads). */
  dryRunAt?: string
  /** The exact osmChange body sent (or about to be sent). */
  osc?: string
  error?: string
}

export interface LinkRecord {
  datasetId: string
  sourceId: string
  apiTarget: ApiTarget
  osmType: OsmObject['osmType']
  osmId: number
}

export interface EventRecord {
  seq?: number
  at: string
  type: string
  datasetId?: string
  apiTarget?: ApiTarget
  account?: string
  sourceId?: string
  data: unknown
}

export interface FetchMetaRecord {
  key: string
  fetchedAt: string
  queryHash: string
  endpoint: string
  count: number
  timestampOsmBase?: string
}

export interface Schema extends DBSchema {
  dataset: { key: string; value: DatasetRecord }
  candidate: { key: [string, string]; value: CandidateRecord; indexes: { datasetId: string } }
  osm_object: {
    key: [string, string, number]
    value: OsmObjectRecord
    indexes: { datasetId: string }
  }
  match: {
    key: [string, string, string, number]
    value: MatchRecord
    indexes: { datasetId: string; candidate: [string, string] }
  }
  decision: { key: [string, string]; value: DecisionRecord; indexes: { datasetId: string } }
  snapshot: { key: [string, string, number]; value: SnapshotRecord; indexes: { batchId: string } }
  batch: { key: string; value: BatchRecord; indexes: { datasetId: string } }
  link: { key: [string, string, ApiTarget]; value: LinkRecord; indexes: { datasetId: string } }
  event: { key: number; value: EventRecord; indexes: { datasetId: string } }
  network_log: { key: number; value: NetworkLogEntry & { seq?: number } }
  fetch_meta: { key: string; value: FetchMetaRecord }
  setting: { key: string; value: { key: string; value: unknown } }
}

export type DB = IDBPDatabase<Schema>

export function openDatabase(name = DB_NAME): Promise<DB> {
  return openDB<Schema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('dataset', { keyPath: 'datasetId' })
        db.createObjectStore('candidate', { keyPath: ['datasetId', 'sourceId'] }).createIndex(
          'datasetId',
          'datasetId',
        )
        db.createObjectStore('osm_object', {
          keyPath: ['datasetId', 'osmType', 'osmId'],
        }).createIndex('datasetId', 'datasetId')
        const match = db.createObjectStore('match', {
          keyPath: ['datasetId', 'sourceId', 'osmType', 'osmId'],
        })
        match.createIndex('datasetId', 'datasetId')
        match.createIndex('candidate', ['datasetId', 'sourceId'])
        db.createObjectStore('decision', { keyPath: ['datasetId', 'sourceId'] }).createIndex(
          'datasetId',
          'datasetId',
        )
        db.createObjectStore('snapshot', { keyPath: ['batchId', 'osmType', 'osmId'] }).createIndex(
          'batchId',
          'batchId',
        )
        db.createObjectStore('batch', { keyPath: 'id' }).createIndex('datasetId', 'datasetId')
        db.createObjectStore('link', {
          keyPath: ['datasetId', 'sourceId', 'apiTarget'],
        }).createIndex('datasetId', 'datasetId')
        db.createObjectStore('event', { keyPath: 'seq', autoIncrement: true }).createIndex(
          'datasetId',
          'datasetId',
        )
        db.createObjectStore('network_log', { keyPath: 'seq', autoIncrement: true })
        db.createObjectStore('fetch_meta', { keyPath: 'key' })
        db.createObjectStore('setting', { keyPath: 'key' })
      }
    },
  })
}

/** Append-only audit event. */
export async function appendEvent(db: DB, e: Omit<EventRecord, 'seq'>): Promise<void> {
  await db.add('event', e)
}

/** A NetworkLogger that persists to the network_log store. */
export const dbNetworkLogger =
  (db: DB) =>
  async (entry: NetworkLogEntry): Promise<void> => {
    await db.add('network_log', entry)
  }
