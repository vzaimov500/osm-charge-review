<script lang="ts">
  import {
    changesFor,
    defaultSelection,
    POSITION_FIXME,
    REJECT_REASONS,
    type RejectReason,
    type RowModel,
    type TargetView,
  } from '../review'
  import * as act from './actions'
  import CopyButton from './CopyButton.svelte'
  import { fmtCoord, fmtDate, fmtDistance, geoUri, osmObjectUrl, osmUrl } from './format'
  import { t, type MessageKey } from './i18n'
  import { distanceM } from '../geo/distance'
  import { IMAGERY, resolveTiles } from './imagery'
  import MiniMap from './MiniMap.svelte'
  import type { AppState } from './state.svelte'
  import TagDiff from './TagDiff.svelte'

  let { row, app }: { row: RowModel; app: AppState } = $props()

  let rejectOpen = $state(false)
  let problem = $state<string | null>(null)
  let showRaw = $state(false)

  const c = $derived(row.candidate)
  const action = $derived(row.decision?.action)
  const target: TargetView | undefined = $derived(act.shownTarget(app, row))
  const decidedOnTarget = $derived(
    action === 'update' &&
      row.decision?.target?.osmType === target?.object.osmType &&
      row.decision?.target?.osmId === target?.object.osmId,
  )
  // What an Update writes: the saved values (ticks and manual edits), else the default ticks.
  const writes: Record<string, string> = $derived.by(() => {
    if (decidedOnTarget && row.decision?.tags) return row.decision.tags
    return target ? changesFor(target.divergence, defaultSelection(target.divergence)) : {}
  })
  const selected = $derived(new Set(Object.keys(writes)))
  const lockedKeys = $derived(['amenity', app.dataset?.info.ref_key ?? ''])
  const lifecycleOrOther = (tv: TargetView) =>
    tv.pair.reasons.includes('lifecycle') ? 'lifecycle' : 'target'
  const nearby = $derived(
    row.targets.map((tv) => ({
      lat: tv.object.lat,
      lon: tv.object.lon,
      type: tv.object.osmType,
      id: tv.object.osmId,
      tags: tv.object.tags,
      label: `${tv.pair.pairClass} · ${fmtDistance(tv.pair.distanceM)}`,
      kind: lifecycleOrOther(tv) as 'target' | 'lifecycle',
    })),
  )

  // The map and the imagery next to it show the same spot.
  let view = $state({ lat: 0, lon: 0, zoom: 18 })
  const source = $derived(IMAGERY.find((s) => s.id === app.imagery) ?? IMAGERY[0]!)
  const imageryTiles = $derived(resolveTiles(source, app.mapboxToken))

  // A new station can be dragged onto the chargers, and flagged when that cannot be checked.
  const placeable = $derived(
    row.match.class !== 'linked' &&
      (action === undefined || action === 'add') &&
      !row.decision?.uploadedBatchId,
  )
  const addOpts = $derived(act.addOptions(app, row))
  const place = $derived(placeable ? addOpts.position : row.decision?.position)
  const movedM = $derived(place ? distanceM(c, place) : 0)
  const shownTags = $derived(
    placeable && addOpts.fixme ? { ...c.tags, fixme: POSITION_FIXME } : c.tags,
  )
  const dragTo = (lat: number, lon: number) =>
    void run(act.setAddOptions(app, row, { position: { lat, lon } }))

  // One detail view serves every row: per-row UI state starts fresh on each selection.
  let shownId = ''
  $effect.pre(() => {
    if (c.sourceId !== shownId) {
      shownId = c.sourceId
      view = { lat: c.lat, lon: c.lon, zoom: 18 }
      if (app.pickedTarget?.sourceId !== c.sourceId) app.pickedTarget = null
      if (app.addDraft?.sourceId !== c.sourceId) app.addDraft = null
      problem = null
      rejectOpen = false
      showRaw = false
    }
  })

  // Keyboard 'r' opens the reason picker (ReviewTable sets rejectRequest).
  let reasonSelect: HTMLSelectElement | undefined = $state()
  $effect(() => {
    if (app.rejectRequest === c.sourceId) {
      rejectOpen = true
      app.rejectRequest = null
      queueMicrotask(() => reasonSelect?.focus())
    }
  })

  // Update needs an existing OSM object nearby to change.
  const canUpdate = $derived(row.targets.length > 0)
  // A linked station is already in OSM: adding it again can only duplicate it.
  const canAdd = $derived(row.match.class !== 'linked')
  const off = (a: string) => (a === 'update' && !canUpdate) || (a === 'add' && !canAdd)
  const offTitle = (a: string) =>
    a === 'update' && !canUpdate
      ? t('detail.noUpdate')
      : a === 'add' && !canAdd
        ? t('detail.noAdd')
        : undefined

  // One line under the buttons says what the station is waiting for.
  const step = $derived.by(() => {
    if (rejectOpen && action !== 'reject') return t('detail.step.reason')
    if (!action) return t('detail.step.choose')
    if (action === 'add' && !canAdd) return t('problem.add_when_linked')
    return t('detail.step.done', { action: t(`action.${action}`) })
  })

  async function run(p: Promise<string[]>) {
    const problems = await p
    problem = problems.length
      ? problems.map((p) => t(`problem.${p}` as MessageKey)).join(' ')
      : null
  }

  function toggle(key: string, on: boolean) {
    const tv = target
    if (!tv) return
    const tags = { ...writes }
    const offered = tv.divergence.tags.find((x) => x.key === key)?.candidate
    if (on && offered !== undefined) tags[key] = offered
    else delete tags[key]
    void run(act.updateWith(app, row, tv, tags, row.decision?.move))
  }

  /** A value typed by the reviewer; empty, or OSM's own value, means no change to that key. */
  function editValue(key: string, value: string) {
    const tv = target
    if (!tv) return
    const tags = { ...writes }
    const v = value.trim()
    if (v === '' || v === tv.object.tags[key]) delete tags[key]
    else tags[key] = v
    void run(act.updateWith(app, row, tv, tags, row.decision?.move))
  }

  function pickTarget(tv: TargetView) {
    problem = null
    void run(act.pickTarget(app, row, tv))
  }

  function setMove(on: boolean) {
    const tv = target
    if (!tv) return
    void run(act.updateWith(app, row, tv, { ...writes }, on))
  }

  function choose(a: 'add' | 'update' | 'reject' | 'skip') {
    problem = null
    if (a === 'add') void run(act.add(app, row))
    if (a === 'update') void run(act.update(app, row, target))
    if (a === 'skip') void run(act.skip(app, row))
    if (a === 'reject') rejectOpen = true
  }

  const WARN_TEXT: Record<string, string> = {
    not_operational: 'not operational',
    adapter_notes: 'adapter notes',
    recent_human_edit: 'recent human edit',
    recent_survey: 'recently surveyed',
    lifecycle_nearby: 'removed/disused station nearby',
    other_ref_nearby: 'another provider record nearby',
    do_not_touch: 'do not touch',
    multiple_candidates: 'several possible targets',
    conflicts: 'conflicting values',
    moved: 'positions differ',
    superseded: 'changed since decision',
  }
</script>

<section class="detail" aria-label={c.label ?? c.sourceId} data-source-id={c.sourceId}>
  <div class="scroll">
    <header>
      <div class="chips">
        <span class="chip class-{row.match.class}"
          >{row.match.class}{#if row.nearestM !== undefined}
            · {fmtDistance(row.nearestM)}{/if}</span
        >
        {#if row.noop}<span class="chip ok">no-op</span>{/if}
        {#each row.warnings as w (w)}<span class="chip warn" title={w}>⚠ {WARN_TEXT[w] ?? w}</span
          >{/each}
      </div>
      <h2>{c.label ?? c.sourceId}</h2>
      {#if c.address}<div class="addr">{c.address}</div>{/if}
      <div class="meta">
        source_id <code>{c.sourceId}</code>{#if c.status}&nbsp;· {c.status}{/if} ·
        <code>{fmtCoord(c.lat)}, {fmtCoord(c.lon)}</code>
        <CopyButton text={`${fmtCoord(c.lat)}, ${fmtCoord(c.lon)}`} label="lat, lon" />
        <CopyButton text={geoUri(c.lat, c.lon)} label="geo:" />
        <CopyButton text={osmUrl(c.lat, c.lon, app.webUrl)} label="osm.org" />
        <a href={osmUrl(c.lat, c.lon, app.webUrl)} target="_blank" rel="noopener"
          >{t('row.openOsm')} ↗</a
        >
        {#if c.sourceRaw}
          <button type="button" class="link" onclick={() => (showRaw = !showRaw)}
            >{t('row.sourceRaw')}</button
          >
        {/if}
      </div>
      {#if showRaw}<pre class="raw">{JSON.stringify(c.sourceRaw, null, 2)}</pre>{/if}
    </header>

    <div class="maps">
      <div class="map" data-testid="map-osm">
        <MiniMap
          big
          web={app.webUrl}
          lat={c.lat}
          lon={c.lon}
          radiusM={row.match.radii.probableM || 50}
          {nearby}
          {view}
          onview={(v) => (view = v)}
          {place}
          ondragto={placeable ? dragTo : undefined}
        />
      </div>
      <div class="map imagery" data-testid="map-imagery">
        <select
          class="layer"
          aria-label={t('imagery.pick')}
          value={source.id}
          onchange={(e) => app.setImagery(e.currentTarget.value)}
        >
          {#each IMAGERY as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
        </select>
        {#if imageryTiles}
          <MiniMap
            big
            web={app.webUrl}
            lat={c.lat}
            lon={c.lon}
            radiusM={row.match.radii.probableM || 50}
            {nearby}
            tiles={imageryTiles}
            {view}
            onview={(v) => (view = v)}
            {place}
            ondragto={placeable ? dragTo : undefined}
          />
        {:else}
          <p class="no-token">{t('imagery.needsToken')}</p>
        {/if}
      </div>
    </div>

    <div class="grid">
      <div class="side">
        {#if placeable}
          <div class="place" data-testid="place">
            {#if place}
              <span data-testid="moved"
                >{t('add.moved', { d: fmtDistance(movedM) })}
                <button
                  type="button"
                  class="link"
                  onclick={() => void run(act.setAddOptions(app, row, { position: null }))}
                  >{t('add.reset')}</button
                ></span
              >
            {:else}
              <span>{t('add.dragHint')}</span>
            {/if}
            <label title={t('add.fixmeHint')}>
              <input
                type="checkbox"
                checked={addOpts.fixme}
                onchange={(e) =>
                  void run(act.setAddOptions(app, row, { fixme: e.currentTarget.checked }))}
              />
              {t('add.fixme')}
            </label>
          </div>
        {/if}
        {#if row.targets.length > 1 || (action === 'update' && row.targets.length > 0)}
          <div class="targets" role="radiogroup" aria-label={t('row.target')}>
            <span class="label">{t('row.target')}</span>
            {#each row.targets as tv (tv.object.osmType + tv.object.osmId)}
              <label class="target">
                <input
                  type="radio"
                  name={`target-${c.sourceId}`}
                  checked={target?.object.osmId === tv.object.osmId &&
                    target?.object.osmType === tv.object.osmType}
                  disabled={tv.doNotTouch}
                  onchange={() => pickTarget(tv)}
                />
                <span>
                  <a
                    href={osmObjectUrl(tv.object.osmType, tv.object.osmId, app.webUrl)}
                    target="_blank"
                    rel="noopener">{tv.object.osmType}/{tv.object.osmId}</a
                  >
                  {tv.pair.pairClass} · {fmtDistance(tv.pair.distanceM)}
                  {#if tv === row.suggested}<em>({t('row.suggested')})</em>{/if}
                  <small
                    >{t('row.lastEdit', {
                      user: tv.object.lastEditUser,
                      date: fmtDate(tv.object.lastEditAt),
                    })}</small
                  >
                </span>
              </label>
            {/each}
          </div>
        {:else if row.targets.length === 0}
          <div class="none">{t('row.noTargets')}</div>
        {/if}
        <!-- Offered before Update is chosen: a position-only difference has nothing else to update. -->
        {#if target?.divergence.moved && (action === 'update' || action === undefined)}
          <label class="move" title={t('row.moveHint')}>
            <input
              type="checkbox"
              checked={action === 'update' && row.decision?.move === true}
              onchange={(e) => setMove(e.currentTarget.checked)}
            />
            {t('row.move', { d: Math.round(target.divergence.distanceM) })}
          </label>
        {/if}
        {#if c.notes}
          <div class="notes"><strong>{t('row.notes')}:</strong> {c.notes}</div>
        {/if}
      </div>
    </div>

    <h3>{t('detail.changes')} <small>{t('detail.changesHint')}</small></h3>
    <TagDiff
      candidateTags={shownTags}
      {target}
      {selected}
      values={writes}
      {lockedKeys}
      editable={!!target && (decidedOnTarget || action === undefined)}
      ontoggle={toggle}
      onedit={editValue}
      fold
    />
    {#if target && !target.divergence.updateNeeded && !decidedOnTarget}<div class="ok-text">
        {t('row.noop')}
      </div>{/if}
  </div>

  <div class="decide">
    <div class="actions" role="radiogroup" aria-label="decision">
      {#each ['update', 'add', 'reject', 'skip'] as const as a, i (a)}
        <label
          class="action action-{a}"
          class:off={off(a)}
          title={offTitle(a)}
          class:on={action === a || (a === 'reject' && rejectOpen && !action)}
          class:suggested={!action &&
            ((a === 'update' && !!row.suggested) || (a === 'add' && row.targets.length === 0))}
        >
          <input
            type="radio"
            name={`action-${c.sourceId}`}
            checked={action === a}
            disabled={off(a)}
            onchange={() => choose(a)}
          />
          {t(`action.${a}`)} <kbd>{i + 1}</kbd>
        </label>
      {/each}
    </div>
    <p class="step" data-testid="step">{step}</p>
    <div class="extra">
      {#if rejectOpen || action === 'reject'}
        <label>
          {t('row.reason')}
          <select
            bind:this={reasonSelect}
            value={row.decision?.reasonCode ?? ''}
            onchange={(e) => {
              rejectOpen = false
              void run(act.reject(app, row, e.currentTarget.value as RejectReason))
            }}
          >
            <option value="" disabled>—</option>
            {#each REJECT_REASONS as r (r)}<option value={r}>{r}</option>{/each}
          </select>
        </label>
      {/if}
      <label>
        {t('row.note')}
        <input
          type="text"
          value={row.decision?.note ?? ''}
          disabled={!row.decision}
          onchange={(e) => void run(act.setNote(app, row, e.currentTarget.value))}
        />
      </label>
      {#if row.decision?.superseded}
        <span class="warn-text">
          {t('row.superseded')}
          <button type="button" onclick={() => void run(act.reconfirm(app, row))}
            >{t('row.reconfirm')}</button
          >
        </span>
      {/if}
      {#if row.decision}<button
          type="button"
          class="link"
          onclick={() => void run(app.decide(row, null))}>{t('row.clear')}</button
        >{/if}
      {#if action === 'add' && row.suggested}<span class="warn-text">{t('row.addWarning')}</span
        >{/if}
      {#if problem}<span class="err-text" role="alert">{problem}</span>{/if}
    </div>
  </div>
</section>

<style>
  .detail {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    min-height: 0;
    container-type: inline-size;
  }
  .scroll {
    flex: 1;
    overflow: auto;
    padding: 0.9rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  h2 {
    margin: 0.25rem 0 0;
    font-size: 1.3rem;
  }
  h3 {
    margin: 0.2rem 0 0;
    font-size: 0.95rem;
  }
  h3 small {
    font-weight: 400;
    opacity: 0.7;
    font-size: 0.78rem;
  }
  .addr,
  .meta,
  .none,
  small {
    font-size: 0.8rem;
    opacity: 0.85;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    align-items: center;
    margin-top: 0.2rem;
  }
  .raw {
    font-size: 0.72rem;
    max-height: 14rem;
    overflow: auto;
    background: var(--muted-bg);
    padding: 0.5rem;
    border-radius: 6px;
  }
  .maps {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0.6rem;
    min-height: 300px;
  }
  .map {
    display: flex;
    min-height: 300px;
    position: relative;
  }
  .layer {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1000;
    max-width: calc(100% - 4.5rem);
    font-size: 0.78rem;
  }
  .no-token {
    margin: 0;
    padding: 3rem 1rem 1rem;
    width: 100%;
    background: var(--muted-bg);
    border-radius: 8px;
    font-size: 0.85rem;
  }
  .place {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.2rem;
    align-items: center;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--change-bg);
    font-size: 0.82rem;
  }
  .place label {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    font-size: 0.85rem;
  }
  .targets {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .label {
    font-size: 0.78rem;
    opacity: 0.75;
  }
  .target {
    display: flex;
    gap: 0.4rem;
    align-items: flex-start;
  }
  .move {
    align-self: flex-start;
    font-size: 0.82rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--change-bg);
  }
  .notes {
    padding: 0.5rem 0.65rem;
    border-radius: 6px;
    background: var(--change-bg);
    font-size: 0.82rem;
    white-space: pre-wrap;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .chip {
    font-size: 0.75rem;
    padding: 0.05rem 0.5rem;
    border-radius: 999px;
    background: var(--muted-bg);
  }
  .class-linked {
    background: #bfdbfe;
    color: #1e3a8a;
  }
  .class-probable {
    background: #dce7fa;
    color: #1e3a8a;
  }
  .class-possible {
    background: #fce3c8;
    color: #7c3a00;
  }
  .class-lifecycle {
    background: #e9ddf6;
    color: #55287e;
  }
  .class-none {
    background: #e9e8e4;
    color: #3b3b3b;
  }
  .warn {
    background: var(--conflict-bg);
  }
  .ok {
    background: #bbf7d0;
    color: #14532d;
  }
  .decide {
    border-top: 1px solid var(--border);
    padding: 0.6rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    background: var(--bar-bg);
  }
  .actions {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.5rem;
  }
  .action {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    height: 2.6rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    font-weight: 600;
    cursor: pointer;
  }
  .action input {
    margin: 0;
  }
  .action.off {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .action.suggested {
    border: 2px solid var(--primary-bg);
  }
  .action.on {
    background: var(--primary-bg);
    color: var(--primary-fg);
    border-color: var(--primary-bg);
  }
  .action-reject.on {
    background: var(--err-fg);
    border-color: var(--err-fg);
  }
  kbd {
    font-size: 0.72rem;
    border: 1px solid currentColor;
    border-radius: 4px;
    padding: 0 0.3rem;
    opacity: 0.7;
  }
  .step {
    margin: 0;
    font-size: 0.8rem;
    opacity: 0.85;
  }
  .extra {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1rem;
    align-items: center;
    font-size: 0.82rem;
  }
  .extra label {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }
  @container (max-width: 36rem) {
    .maps {
      grid-template-columns: minmax(0, 1fr);
    }
    .actions {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .link {
    border: 0;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
  }
  .warn-text {
    color: var(--warn-fg);
  }
  .err-text {
    color: var(--err-fg);
  }
  .ok-text {
    color: var(--ok-fg);
    font-size: 0.85rem;
  }
</style>
