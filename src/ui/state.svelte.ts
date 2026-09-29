/* eslint-disable svelte/prefer-svelte-reactivity --
   Maps and Dates here are either local temporaries or immutable values that
   are replaced wholesale inside $state.raw; they are never mutated in place. */
/**
 * Application state (Svelte 5 runes). The only place where pure modules meet
 * storage and the network. Every decision goes through `decide()`, which
 * validates and persists it — there is no other write path.
 */
import { dbNetworkLogger } from '../store/db'
import { bboxOf, type BBox } from '../geo/distance'
import { parseCandidateText, type Issue, type ParsedDataset } from '../format'
import { classifyAll, DEFAULT_MATCH_CONFIG, type CandidateMatch, type MatchConfig } from '../match'
import { apiFor, BUILT_IN_CLIENT_IDS, isSignedIn, signIn, signOut } from '../osm/auth'
import { buildRegionQuery, parseRegionResponse } from '../osm/build/regionQuery'
import { ApiError, TARGETS, type ApiTarget } from '../osm/transport/api'
import { createBatches, dryRunOsc, recoverBatch, runBatch, type BatchOutcome } from '../osm/upload'
import { auditReportMarkdown } from '../audit/report'
import { revertBatch, verifyBatch } from '../audit/verify'
import type { RevertPlan } from '../osm/build/verify'
import {
  loadStations,
  SandboxAreaError,
  stationsMetaKey,
  type StationSource,
} from '../osm/overpass/stationCache'
import { OVERPASS_ENDPOINTS, OverpassError, runOverpass } from '../osm/transport/overpass'
import { osmKey, type OsmObject } from '../osm/types'
import {
  buildRow,
  computeStats,
  DEFAULT_FILTERS,
  filterAndSort,
  filtersFromQuery,
  filtersToQuery,
  confirmsLive,
  EMPTY_LIVE_SETTINGS,
  FIRST_LIVE_BATCH,
  liveGateProblems,
  validateDecision,
  type Decision,
  type Filters,
  type GateProblem,
  type LiveSettings,
  type RowModel,
} from '../review'
import { importDataset, listDatasets, loadCandidates, type ImportSummary } from '../store/datasets'
import {
  appendEvent,
  openDatabase,
  type BatchRecord,
  type CandidateRecord,
  type DatasetRecord,
  type DB,
} from '../store/db'
import { clearDecision, loadDecisions, saveDecision } from '../store/decisions'
import { saveMatchRun } from '../store/matches'
import {
  exportState,
  exportStatus,
  importState,
  readStateFile,
  StateFileError,
  type ImportPlan,
  type StateFile,
} from '../store/backup'
import {
  checkStorage,
  isQuotaError,
  requestPersistence,
  type StorageStatus,
} from '../store/storage'
import { CREATED_BY, TOOL_URL } from '../version'
import { t } from './i18n'

export type Notice = { kind: 'info' | 'error'; text: string; exportPrompt?: boolean }

export interface PendingFile {
  text: string
  issues: Issue[]
  parsed?: ParsedDataset
}

export class AppState {
  db: DB | null = null
  ready = $state(false)
  fatal = $state<string | null>(null)
  storage = $state.raw<StorageStatus | null>(null)
  datasets = $state.raw<DatasetRecord[]>([])
  dataset = $state.raw<DatasetRecord | null>(null)
  candidates = $state.raw<CandidateRecord[]>([])
  objects = $state.raw<OsmObject[]>([])
  osmMeta = $state.raw<{ fetchedAt: string; count: number; source: StationSource } | null>(null)
  matches = $state.raw<CandidateMatch[]>([])
  decisions = $state.raw<ReadonlyMap<string, Decision>>(new Map())
  filters = $state<Filters>({ ...DEFAULT_FILTERS })
  cfg = $state.raw<MatchConfig>(DEFAULT_MATCH_CONFIG)
  endpoint = $state<string>(OVERPASS_ENDPOINTS[0])
  busy = $state<string | null>(null)
  notice = $state<Notice | null>(null)
  pending = $state.raw<PendingFile | null>(null)
  focused = $state(0)
  /** "Last exported" indicator. */
  exportInfo = $state.raw<{ lastExportAt?: string; decisionsSince: number }>({ decisionsSince: 0 })
  // ---- Environment and upload ----
  /**
   * The environment: where OSM data is read from AND where edits are written,
   * always the same server. Reading live OSM is always allowed; writing to it
   * needs the live gate (`liveUnlocked`).
   */
  target = $state<ApiTarget>('live')
  /** Writing to live OSM was unlocked through the gate — for this session only. */
  liveUnlocked = $state(false)
  clientIds = $state<Record<ApiTarget, string>>({ ...BUILT_IN_CLIENT_IDS })
  account = $state<string | null>(null)
  batches = $state.raw<BatchRecord[]>([])
  showUpload = $state(false)
  /** Pacing: minimum seconds between batches. */
  batchDelayS = $state(60)
  lastBatchAt = $state(0)
  /** Pacing: at most this many batches per session. */
  sessionCap = $state(10)
  sessionBatches = $state(0)
  // ---- Live gating ----
  liveSettings = $state<LiveSettings>(structuredClone(EMPTY_LIVE_SETTINGS))
  showLiveGate = $state(false)
  liveProblems: GateProblem[] = $derived(
    liveGateProblems(this.liveSettings, {
      licenceStatus: this.dataset?.info.licence_status ?? 'unverified',
      liveClientId: this.clientIds.live,
      now: Date.now(),
    }),
  )

  /** A revert planned (dry run) and awaiting confirmation. */
  pendingRevert = $state.raw<{ batch: BatchRecord; plan: RevertPlan } | null>(null)

  /** A state file read and planned, awaiting the operator's confirmation. */
  pendingImport = $state.raw<{ file: StateFile; plan: ImportPlan; name: string } | null>(null)
  /** Set by the keyboard handler to open the reject-reason picker on a row. */
  rejectRequest = $state<string | null>(null)

  rows: RowModel[] = $derived.by(() => {
    const objectsByKey = new Map(this.objects.map((o) => [osmKey(o), o]))
    const bySource = new Map(this.matches.map((m) => [m.sourceId, m]))
    const now = Date.now()
    return this.candidates.map((c) =>
      buildRow(
        c,
        bySource.get(c.sourceId) ?? {
          sourceId: c.sourceId,
          class: 'none',
          pairs: [],
          radii: { probableM: 0, possibleM: 0 },
        },
        this.decisions.get(c.sourceId),
        {
          objectsByKey,
          cfg: this.cfg,
          now,
        },
      ),
    )
  })
  /** sourceId → administrative area name. */
  regions = $state.raw<ReadonlyMap<string, string>>(new Map())
  regionNames: string[] = $derived(
    [...new Set(this.regions.values())].sort((a, b) => a.localeCompare(b, 'bg')),
  )
  visible: RowModel[] = $derived(
    filterAndSort(this.rows, this.filters, (r) => this.regions.get(r.candidate.sourceId)),
  )
  stats = $derived(computeStats(this.rows))

  async init(): Promise<void> {
    this.storage = await checkStorage()
    if (!this.storage.indexedDb) {
      this.fatal = t('storage.unavailable')
      return
    }
    try {
      this.db = await openDatabase()
    } catch {
      this.fatal = t('storage.unavailable')
      return
    }
    this.filters = filtersFromQuery(location.search)
    this.datasets = await listDatasets(this.db)
    const env = (await this.db.get('setting', 'environment'))?.value
    if (env === 'sandbox' || env === 'live') this.target = env
    const last = (await this.db.get('setting', 'lastDataset'))?.value
    const pick = this.datasets.find((d) => d.datasetId === last) ?? this.datasets[0]
    if (pick) await this.selectDataset(pick.datasetId)
    await this.refreshExportInfo()
    for (const t of ['sandbox', 'live'] as const) {
      const id = (await this.db.get('setting', `clientId:${t}`))?.value
      if (typeof id === 'string' && id) this.clientIds = { ...this.clientIds, [t]: id }
    }
    if (isSignedIn(this.target, this.clientIds[this.target])) void this.loadAccount()
    this.ready = true
  }

  // ---- Export / import of the whole working state --------------------

  async refreshExportInfo(): Promise<void> {
    if (this.db) this.exportInfo = await exportStatus(this.db)
  }

  /** Build the export and hand it to the browser as a download. */
  async exportNow(): Promise<void> {
    if (!this.db) return
    const file = await exportState(this.db)
    download(
      `osm-charge-review-state-${file.exported_at.slice(0, 19).replace(/[:T]/g, '-')}.json`,
      JSON.stringify(file),
      'application/json',
    )
    await this.refreshExportInfo()
  }

  /** Read a state file and show what importing it would do; nothing is written yet. */
  async readStateImport(f: File): Promise<void> {
    if (!this.db) return
    try {
      const file = await readStateFile(await f.text())
      this.pendingImport = { file, plan: await importState(this.db, file, true), name: f.name }
    } catch (e) {
      this.notice = { kind: 'error', text: e instanceof StateFileError ? e.message : String(e) }
    }
  }

  async confirmStateImport(): Promise<void> {
    const p = this.pendingImport
    if (!p || !this.db) return
    await this.guard(() => importState(this.db!, p.file))
    this.pendingImport = null
    this.datasets = await listDatasets(this.db)
    const pick = this.dataset?.datasetId ?? this.datasets[0]?.datasetId
    if (pick) await this.selectDataset(pick)
    await this.refreshExportInfo()
    this.notice = {
      kind: 'info',
      text: t('backup.imported', {
        decisions: p.plan.write.decision,
        kept: p.plan.keptLocalDecisions,
      }),
    }
  }

  // ---- Sign-in and batches -------------------------------------------

  private api() {
    return apiFor(this.target, this.clientIds[this.target], dbNetworkLogger(this.db!))
  }

  async setClientId(target: ApiTarget, id: string): Promise<void> {
    this.clientIds = { ...this.clientIds, [target]: id.trim() }
    await this.db?.put('setting', { key: `clientId:${target}`, value: id.trim() })
    const signedIn = isSignedIn(target, this.clientIds[target])
    if (target === this.target) {
      this.account = null
      if (signedIn) await this.loadAccount()
    }
  }

  /** Synchronous up to the popup: called straight from the click. */
  signInClick(): void {
    signIn(this.target, this.clientIds[this.target], (err) => {
      if (err) this.notice = { kind: 'error', text: `Sign-in failed: ${err.message}` }
      else void this.loadAccount()
    })
  }

  signOutClick(): void {
    signOut(this.target, this.clientIds[this.target])
    this.account = null
  }

  async loadAccount(): Promise<void> {
    try {
      this.account = (await this.api().userDetails()).displayName
    } catch (e) {
      this.account = null
      this.notice = { kind: 'error', text: `Could not read the signed-in account: ${String(e)}` }
    }
  }

  async loadBatches(): Promise<void> {
    if (!this.db || !this.dataset) return
    const all = await this.db.getAllFromIndex('batch', 'datasetId', this.dataset.datasetId)
    this.batches = all
      .filter((b) => b.apiTarget === this.target)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** Group ready decisions into geographically compact batches. */
  async planBatches(): Promise<void> {
    const db = this.db
    const ds = this.dataset
    if (!db || !ds) return
    // Edits of existing objects must come from this target's own data: live
    // object ids mean nothing in the sandbox and vice versa. New stations are fine.
    const sameData = this.osmMeta?.source === (this.target === 'sandbox' ? 'sandbox' : 'overpass')
    const planned = new Set(
      this.batches
        .filter((b) => b.status === 'draft' || b.status === 'in_flight')
        .flatMap((b) => b.sourceIds),
    )
    const ready = this.rows.filter(
      (r) => r.decided && r.decision && !planned.has(r.candidate.sourceId),
    )
    const inputs = ready
      .filter((r) => sameData || r.decision!.action !== 'update')
      .map((r) => ({ candidate: r.candidate, decision: r.decision! }))
    const held = ready.length - inputs.length
    // Until a live batch has been verified, live batches stay small and local.
    const firstLive = this.target === 'live' && !this.batches.some((b) => b.status === 'verified')
    const made = await createBatches(db, inputs, {
      datasetId: ds.datasetId,
      target: this.target,
      info: ds.info,
      regionOf: (id) => this.regions.get(id),
      ...(firstLive ? FIRST_LIVE_BATCH : {}),
    })
    await this.loadBatches()
    this.notice = held
      ? {
          kind: 'error',
          text: t('upload.heldForSource', { n: made.length, held, target: this.target }),
        }
      : { kind: 'info', text: t('upload.planned', { n: made.length }) }
  }

  async discardBatch(b: BatchRecord): Promise<void> {
    if (!this.db || b.status !== 'draft') return
    await this.db.delete('batch', b.id)
    await appendEvent(this.db, {
      at: new Date().toISOString(),
      type: 'batch_discarded',
      datasetId: b.datasetId,
      apiTarget: b.apiTarget,
      data: { batchId: b.id },
    })
    await this.loadBatches()
  }

  /** Download the .osc a batch would upload now, for JOSM (dry run). */
  async dryRun(b: BatchRecord): Promise<void> {
    await this.withBusy(t('upload.dryRunBusy'), async () => {
      const { osc, excluded } = await dryRunOsc(this.api(), b)
      download(`${b.id.replace(/[^\w-]+/g, '_')}.osc`, osc, 'application/xml')
      await this.db!.put('batch', { ...b, dryRunAt: new Date().toISOString() })
      await this.loadBatches()
      if (excluded.length)
        this.notice = { kind: 'info', text: t('upload.dryRunExcluded', { n: excluded.length }) }
    })
  }

  /** Seconds until the pacing delay allows the next batch. */
  get pacingWaitS(): number {
    return Math.max(0, Math.ceil((this.lastBatchAt + this.batchDelayS * 1000 - Date.now()) / 1000))
  }

  /** Edits may be written: always to the sandbox; to live only once unlocked. */
  get canWrite(): boolean {
    return this.target === 'sandbox' || this.liveUnlocked
  }

  private refuseLockedWrite(): boolean {
    if (this.canWrite) return false
    this.notice = { kind: 'error', text: t('env.writeLocked') }
    return true
  }

  async uploadBatch(b: BatchRecord): Promise<void> {
    if (!this.db || !this.dataset || !this.account || this.refuseLockedWrite()) return
    const ctx = this.ctx()
    await this.withBusy(t('upload.busy'), async () => {
      const out = await runBatch(ctx, b.id)
      this.lastBatchAt = Date.now()
      this.sessionBatches++
      // Read-back verification after every batch.
      if (out.step === 'verify') await verifyBatch(ctx, b.id)
      await this.afterBatch(out)
    })
  }

  async recover(b: BatchRecord): Promise<void> {
    if (!this.db || !this.dataset || this.refuseLockedWrite()) return
    const ctx = {
      db: this.db,
      api: this.api(),
      account: this.account ?? '',
      info: this.dataset.info,
    }
    await this.withBusy(t('upload.recovering'), async () => {
      const out = await recoverBatch(ctx, b.id)
      if (out.step === 'verify') await verifyBatch(ctx, b.id)
      await this.afterBatch(out)
    })
  }

  private ctx() {
    const c: import('../osm/upload').RunContext = {
      db: this.db!,
      api: this.api(),
      account: this.account ?? '',
      info: this.dataset!.info,
    }
    if (this.target === 'live') {
      c.wikiUrl = this.liveSettings.wikiUrl.trim()
      c.forumUrl = this.liveSettings.forumUrl.trim()
    }
    return c
  }

  // ---- Live gating ----------------------------------------------

  async saveLiveSettings(patch: Partial<LiveSettings>): Promise<void> {
    this.liveSettings = { ...this.liveSettings, ...patch }
    if (this.db && this.dataset)
      await this.db.put('setting', {
        key: `live:${this.dataset.datasetId}`,
        value: $state.snapshot(this.liveSettings),
      })
  }

  /** Switch environment: both reading and writing move to the other server. */
  async setEnvironment(env: ApiTarget): Promise<void> {
    if (env === this.target) return
    this.target = env
    this.liveUnlocked = false
    this.showLiveGate = false
    this.pendingRevert = null
    this.account = null
    if (this.db) {
      await this.db.put('setting', { key: 'environment', value: env })
      await appendEvent(this.db, {
        at: new Date().toISOString(),
        type: 'environment_switched',
        ...(this.dataset ? { datasetId: this.dataset.datasetId } : {}),
        apiTarget: env,
        data: { to: env, apiUrl: TARGETS[env].apiUrl },
      })
    }
    if (isSignedIn(env, this.clientIds[env])) await this.loadAccount()
    await this.loadCachedObjects()
    await this.loadBatches()
  }

  /** Unlock writing to live: only with no gate problems, a signed-in live account, and the typed word. */
  async unlockLive(typed: string): Promise<boolean> {
    if (
      this.target !== 'live' ||
      this.liveProblems.length > 0 ||
      !this.account ||
      !confirmsLive(typed)
    )
      return false
    this.liveUnlocked = true
    this.showLiveGate = false
    await appendEvent(this.db!, {
      at: new Date().toISOString(),
      type: 'live_write_unlocked',
      ...(this.dataset ? { datasetId: this.dataset.datasetId } : {}),
      apiTarget: 'live',
      account: this.account,
      data: { apiUrl: TARGETS.live.apiUrl },
    })
    return true
  }

  /** Read-back on demand. */
  async verify(b: BatchRecord): Promise<void> {
    if (!this.db || !this.dataset) return
    await this.withBusy(t('verify.busy'), async () => {
      const res = await verifyBatch(this.ctx(), b.id)
      await this.loadBatches()
      const bad = res.filter((r) => r.state !== 'match')
      this.notice = bad.length
        ? {
            kind: 'error',
            text: t('verify.bad', {
              n: bad.length,
              total: res.length,
              list: bad.map((r) => `${r.object} ${r.state}`).join('; '),
            }),
          }
        : { kind: 'info', text: t('verify.ok', { total: res.length }) }
    })
  }

  /** Revert step 1: plan without writing, and show it. */
  async planRevert(b: BatchRecord): Promise<void> {
    if (!this.db || !this.dataset) return
    await this.withBusy(t('verify.busy'), async () => {
      this.pendingRevert = { batch: b, plan: (await revertBatch(this.ctx(), b.id, true)).plan }
    })
  }

  /** Revert step 2: the operator confirmed the plan. */
  async confirmRevert(): Promise<void> {
    const p = this.pendingRevert
    if (!p || !this.account || this.refuseLockedWrite()) return
    this.pendingRevert = null
    await this.withBusy(t('revert.busy'), async () => {
      const out = await revertBatch(this.ctx(), p.batch.id)
      await this.loadBatches()
      this.decisions = await loadDecisions(this.db!, this.dataset!.datasetId)
      this.notice = {
        kind: out.plan.manual.length ? 'error' : 'info',
        text: t('revert.done', {
          n: out.plan.items.length,
          cs: out.changesetId ?? '—',
          manual: out.plan.manual.length,
        }),
        exportPrompt: true,
      }
    })
  }

  /** Audit trail export: readable per-batch Markdown plus the raw logs. */
  async exportAudit(): Promise<void> {
    const db = this.db
    const ds = this.dataset
    if (!db || !ds) return
    const batches = await db.getAllFromIndex('batch', 'datasetId', ds.datasetId)
    const events = await db.getAllFromIndex('event', 'datasetId', ds.datasetId)
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const md = auditReportMarkdown(ds.info.dataset_name, batches, events, {
      webUrl: TARGETS[this.target].authUrl,
    })
    download(`audit-${ds.datasetId}-${stamp}.md`, md, 'text/markdown')
    const raw = {
      dataset: ds.datasetId,
      exportedAt: new Date().toISOString(),
      events,
      networkLog: await db.getAll('network_log'),
    }
    download(
      `audit-${ds.datasetId}-${stamp}.json`,
      JSON.stringify(raw, null, 1),
      'application/json',
    )
  }

  private async afterBatch(out: BatchOutcome): Promise<void> {
    await this.loadBatches()
    this.decisions = await loadDecisions(this.db!, this.dataset!.datasetId)
    await this.refreshExportInfo()
    // Prompt for an export after every batch.
    this.notice = {
      kind: out.error ? 'error' : 'info',
      text: out.error ?? t('upload.done', { uploaded: out.uploaded, excluded: out.excluded }),
      exportPrompt: true,
    }
  }

  private async withBusy(label: string, fn: () => Promise<void>): Promise<void> {
    this.busy = label
    try {
      await fn()
    } catch (e) {
      this.notice = { kind: 'error', text: String(e instanceof Error ? e.message : e) }
    } finally {
      this.busy = null
    }
  }

  /** User-initiated: some browsers prompt. */
  async persist(): Promise<void> {
    const granted = await requestPersistence()
    this.storage = { ...(this.storage ?? { indexedDb: true }), persisted: granted }
  }

  /** Reflect filters in the URL without reloading. */
  syncUrl(): void {
    const q = filtersToQuery(this.filters)
    const url = `${location.pathname}${q ? `?${q}` : ''}${location.hash}`
    if (url !== `${location.pathname}${location.search}${location.hash}`)
      history.replaceState(null, '', url)
  }

  // ---- Loading ---------------------------------------------------------------

  async readFile(file: File): Promise<void> {
    const text = await file.text()
    const r = parseCandidateText(text)
    this.pending = r.ok ? { text, issues: r.issues, parsed: r.dataset } : { text, issues: r.issues }
    if (r.ok && !r.issues.some((i) => i.severity === 'confirm')) await this.confirmPending()
  }

  async confirmPending(): Promise<void> {
    const p = this.pending
    if (!p?.parsed || !this.db) return
    await this.guard(async () => {
      const s: ImportSummary = await importDataset(this.db!, p.parsed!, p.text)
      this.pending = null
      this.datasets = await listDatasets(this.db!)
      await this.selectDataset(s.datasetId)
      this.notice = { kind: 'info', text: t('loader.imported', { ...s }) }
    })
  }

  async selectDataset(datasetId: string): Promise<void> {
    const db = this.db!
    this.dataset = (await db.get('dataset', datasetId)) ?? null
    this.candidates = await loadCandidates(db, datasetId)
    this.decisions = await loadDecisions(db, datasetId)
    await this.loadCachedObjects()
    await this.loadBatches()
    const live = (await db.get('setting', `live:${datasetId}`))?.value as LiveSettings | undefined
    this.liveSettings = live
      ? { ...EMPTY_LIVE_SETTINGS, ...live }
      : structuredClone(EMPTY_LIVE_SETTINGS)
    const stored = (await db.get('setting', `regions:${datasetId}`))?.value as
      Record<string, string> | undefined
    this.regions = new Map(Object.entries(stored ?? {}))
    await db.put('setting', { key: 'lastDataset', value: datasetId })
  }

  // ---- OSM data and matching ---------------------------------------------------

  /** Station data follows the environment: Overpass mirrors live OSM; the sandbox is read through its API. */
  get stationSource(): StationSource {
    return this.target === 'sandbox' ? 'sandbox' : 'overpass'
  }

  /** The stored snapshot for the current target, if any (none after switching targets). */
  private async loadCachedObjects(): Promise<void> {
    const db = this.db
    const ds = this.dataset
    if (!db || !ds) return
    const meta = await db.get('fetch_meta', stationsMetaKey(this.stationSource, ds.datasetId))
    this.objects = meta
      ? (await db.getAllFromIndex('osm_object', 'datasetId', ds.datasetId)).map(stripObject)
      : []
    this.osmMeta = meta
      ? { fetchedAt: meta.fetchedAt, count: meta.count, source: this.stationSource }
      : null
    this.rematch(false)
  }

  async fetchOsm(force: boolean): Promise<void> {
    const db = this.db
    const ds = this.dataset
    const box = bboxOf(this.candidates)
    if (!db || !ds || !box) return
    this.busy = t('osm.busy')
    try {
      const source = this.stationSource
      const endpoint = source === 'sandbox' ? TARGETS.sandbox.apiUrl : this.endpoint
      const api = source === 'sandbox' ? this.api() : null
      const r = await loadStations(db, {
        datasetId: ds.datasetId,
        bbox: box,
        refKey: ds.info.ref_key,
        force,
        endpoint,
        run: (q) => runOverpass(q, { endpoint, logger: dbNetworkLogger(db) }),
        ...(api ? { sandboxMap: (b: BBox) => api.map(b) } : {}),
      })
      this.objects = r.objects
      this.osmMeta = { fetchedAt: r.fetchedAt, count: r.objects.length, source }
      this.rematch(true)
    } catch (e) {
      this.notice = {
        kind: 'error',
        text:
          e instanceof OverpassError || e instanceof SandboxAreaError || e instanceof ApiError
            ? e.message
            : String(e),
      }
    } finally {
      this.busy = null
    }
  }

  /** One Overpass request for all candidates' administrative areas, cached per dataset. */
  async loadRegions(): Promise<void> {
    const db = this.db
    const ds = this.dataset
    if (!db || !ds || this.candidates.length === 0) return
    this.busy = t('regions.busy')
    try {
      const cands = this.candidates
      const q = buildRegionQuery(cands, { identifier: `${CREATED_BY} ${TOOL_URL}` })
      const names = parseRegionResponse(
        await runOverpass(q, { endpoint: this.endpoint, logger: dbNetworkLogger(db) }),
        cands.length,
      )
      const bySource: Record<string, string> = {}
      cands.forEach((c, i) => {
        const n = names[i]
        if (n !== undefined) bySource[c.sourceId] = n
      })
      await db.put('setting', { key: `regions:${ds.datasetId}`, value: bySource })
      this.regions = new Map(Object.entries(bySource))
    } catch (e) {
      this.notice = { kind: 'error', text: e instanceof OverpassError ? e.message : String(e) }
    } finally {
      this.busy = null
    }
  }

  private rematch(record: boolean): void {
    const ds = this.dataset
    if (!ds) return
    this.matches = classifyAll(this.candidates, this.objects, ds.info.ref_key, this.cfg)
    if (record && this.db)
      void saveMatchRun(this.db, ds.datasetId, this.matches, this.cfg, new Date().toISOString())
  }

  // ---- Decisions -----------------------------------------------------------------

  /**
   * The only write path for decisions. Returns the problems if the decision is
   * invalid (nothing is stored then).
   */
  async decide(
    row: RowModel,
    d: Omit<Decision, 'decidedAt' | 'contentHash' | 'superseded'> | null,
  ): Promise<string[]> {
    const db = this.db
    const ds = this.dataset
    if (!db || !ds) return []
    const sourceId = row.candidate.sourceId
    const at = new Date().toISOString()
    if (d === null) {
      await this.guard(() => clearDecision(db, ds.datasetId, sourceId, at))
      const next = new Map(this.decisions)
      next.delete(sourceId)
      this.decisions = next
      this.exportInfo = { ...this.exportInfo, decisionsSince: this.exportInfo.decisionsSince + 1 }
      return []
    }
    const full: Decision = {
      ...d,
      decidedAt: at,
      contentHash: row.candidate.contentHash,
      superseded: false,
    }
    const problems = validateDecision(row, full)
    if (problems.length > 0) return problems
    await this.guard(() => saveDecision(db, ds.datasetId, sourceId, full))
    this.decisions = new Map(this.decisions).set(sourceId, full)
    this.exportInfo = { ...this.exportInfo, decisionsSince: this.exportInfo.decisionsSince + 1 }
    return []
  }

  private async guard(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn()
    } catch (e) {
      this.notice = { kind: 'error', text: isQuotaError(e) ? t('storage.quota') : String(e) }
      throw e
    }
  }
}

function stripObject<T extends OsmObject>(
  r: T & { datasetId?: string; fetchedAt?: string },
): OsmObject {
  const { datasetId: _d, fetchedAt: _f, ...o } = r
  return o
}

/** Hand a generated file to the browser as a download. */
function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
