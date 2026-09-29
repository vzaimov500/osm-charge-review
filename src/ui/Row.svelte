<script lang="ts">
  import {
    changeableKeys,
    defaultSelection,
    REJECT_REASONS,
    type RejectReason,
    type RowModel,
    type TargetView,
  } from '../review'
  import * as act from './actions'
  import CopyButton from './CopyButton.svelte'
  import { fmtCoord, fmtDate, fmtDistance, geoUri, osmObjectUrl, osmUrl } from './format'
  import { t, type MessageKey } from './i18n'
  import MiniMap from './MiniMap.svelte'
  import type { AppState } from './state.svelte'
  import TagDiff from './TagDiff.svelte'

  let {
    row,
    app,
    focused,
    onfocus,
  }: { row: RowModel; app: AppState; focused: boolean; onfocus: () => void } = $props()

  let rejectOpen = $state(false)
  let problem = $state<string | null>(null)
  let showRaw = $state(false)

  const c = $derived(row.candidate)
  const action = $derived(row.decision?.action)
  const target: TargetView | undefined = $derived(
    action === 'update' ? act.chosenTarget(row) : row.suggested,
  )
  const selected = $derived.by(() => {
    if (action === 'update' && row.decision?.tags) return new Set(Object.keys(row.decision.tags))
    const tv = target
    return new Set(
      tv
        ? Object.entries(defaultSelection(tv.divergence))
            .filter(([, on]) => on)
            .map(([k]) => k)
        : [],
    )
  })
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

  // Keyboard 'r' on the focused row opens the reason picker (ReviewTable sets rejectRequest).
  let reasonSelect: HTMLSelectElement | undefined = $state()
  $effect(() => {
    if (app.rejectRequest === c.sourceId) {
      rejectOpen = true
      app.rejectRequest = null
      queueMicrotask(() => reasonSelect?.focus())
    }
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
    const sel: Record<string, boolean> = {}
    for (const k of changeableKeys(tv.divergence))
      sel[k.key] = k.key === key ? on : selected.has(k.key)
    void run(act.update(app, row, tv, sel, row.decision?.move))
  }

  function pickTarget(tv: TargetView) {
    void run(act.update(app, row, tv))
  }

  function setMove(on: boolean) {
    const tv = target
    if (!tv) return
    const sel = Object.fromEntries(
      changeableKeys(tv.divergence).map((k) => [k.key, selected.has(k.key)]),
    )
    void run(act.update(app, row, tv, sel, on))
  }

  function choose(a: 'add' | 'update' | 'reject' | 'skip') {
    problem = null
    if (a === 'add') void run(act.add(app, row))
    if (a === 'update') void run(act.update(app, row))
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

<!-- Clicking a row focuses it for the keyboard workflow; j/k do the same without a mouse. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article
  class="row"
  class:focused
  class:decided={row.decided}
  onclick={onfocus}
  data-source-id={c.sourceId}
>
  <div class="col info">
    <div class="chips">
      <span class="chip class-{row.match.class}">{row.match.class}</span>
      {#if row.noop}<span class="chip ok">no-op</span>{/if}
      {#each row.warnings as w (w)}<span class="chip warn" title={w}>⚠ {WARN_TEXT[w] ?? w}</span
        >{/each}
    </div>
    <h3>{c.label ?? c.sourceId}</h3>
    {#if c.address}<div class="addr">{c.address}</div>{/if}
    <div class="meta">
      source_id <code>{c.sourceId}</code>{#if c.status}&nbsp;· {c.status}{/if}
    </div>
    <div class="coords">
      <code>{fmtCoord(c.lat)}, {fmtCoord(c.lon)}</code>
      <CopyButton text={`${fmtCoord(c.lat)}, ${fmtCoord(c.lon)}`} label="lat, lon" />
      <CopyButton text={geoUri(c.lat, c.lon)} label="geo:" />
      <CopyButton text={osmUrl(c.lat, c.lon)} label="osm.org" />
      <a href={osmUrl(c.lat, c.lon)} target="_blank" rel="noopener">{t('row.openOsm')} ↗</a>
    </div>
    {#if c.notes}<details open>
        <summary>{t('row.notes')}</summary>
        <pre class="notes">{c.notes}</pre>
      </details>{/if}
    {#if c.sourceRaw}
      <button type="button" class="link" onclick={() => (showRaw = !showRaw)}
        >{t('row.sourceRaw')}</button
      >
      {#if showRaw}<pre class="raw">{JSON.stringify(c.sourceRaw, null, 2)}</pre>{/if}
    {/if}
  </div>

  <div class="col tags">
    {#if row.targets.length > 1 || (action === 'update' && row.targets.length > 0)}
      <div class="targets" role="radiogroup" aria-label={t('row.target')}>
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
            <a
              href={osmObjectUrl(tv.object.osmType, tv.object.osmId)}
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
          </label>
        {/each}
      </div>
    {:else if row.targets.length === 0}
      <div class="none">{t('row.noTargets')}</div>
    {/if}
    <TagDiff
      candidateTags={c.tags}
      {target}
      {selected}
      editable={action === 'update'}
      ontoggle={toggle}
    />
    <!-- Offered before Update is chosen: a position-only difference has nothing else to update. -->
    {#if target?.divergence.moved && (action === 'update' || action === undefined)}
      <label class="move">
        <input
          type="checkbox"
          checked={action === 'update' && row.decision?.move === true}
          onchange={(e) => setMove(e.currentTarget.checked)}
        />
        {t('row.move', { d: Math.round(target.divergence.distanceM) })}
      </label>
    {/if}
    {#if row.noop && action !== 'update'}<div class="ok-text">{t('row.noop')}</div>{/if}
  </div>

  <MiniMap lat={c.lat} lon={c.lon} radiusM={row.match.radii.probableM || 50} {nearby} />

  <div class="col decide">
    <div class="actions" role="radiogroup" aria-label="decision">
      {#each ['add', 'update', 'reject', 'skip'] as const as a (a)}
        <label
          class="action action-{a}"
          class:on={action === a || (a === 'reject' && rejectOpen && !action)}
        >
          <input
            type="radio"
            name={`action-${c.sourceId}`}
            checked={action === a}
            onchange={() => choose(a)}
          />
          {t(`action.${a}`)} <kbd>{a[0]}</kbd>
        </label>
      {/each}
    </div>
    {#if action === 'add' && row.suggested}<div class="warn-text">{t('row.addWarning')}</div>{/if}
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
      <div class="warn-text">
        {t('row.superseded')}
        <button type="button" onclick={() => void run(act.reconfirm(app, row))}
          >{t('row.reconfirm')}</button
        >
      </div>
    {/if}
    {#if row.decision}<button
        type="button"
        class="link"
        onclick={() => void run(app.decide(row, null))}>{t('row.clear')}</button
      >{/if}
    {#if problem}<div class="err-text" role="alert">{problem}</div>{/if}
  </div>
</article>

<style>
  .row {
    display: flex;
    gap: 0.75rem;
    padding: 0.6rem 0.75rem;
    border-bottom: 1px solid var(--border);
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
  }
  .row.focused {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .row.decided {
    background: var(--decided-bg);
  }
  .col {
    min-width: 0;
    overflow: auto;
  }
  .info {
    flex: 1.1;
  }
  .tags {
    flex: 1.6;
  }
  .decide {
    flex: 0 0 13rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.85rem;
  }
  h3 {
    margin: 0.2rem 0 0;
    font-size: 0.95rem;
  }
  .addr,
  .meta,
  .none,
  small {
    font-size: 0.78rem;
    opacity: 0.8;
  }
  .coords {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: center;
    font-size: 0.78rem;
    margin-top: 0.2rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
  }
  .chip {
    font-size: 0.7rem;
    padding: 0 0.35rem;
    border-radius: 999px;
    background: var(--muted-bg);
  }
  .class-linked {
    background: #bfdbfe;
    color: #1e3a8a;
  }
  .class-probable {
    background: #bbf7d0;
    color: #14532d;
  }
  .class-possible {
    background: #fef08a;
    color: #713f12;
  }
  .class-lifecycle {
    background: #e5e7eb;
    color: #374151;
  }
  .class-none {
    background: #fbcfe8;
    color: #831843;
  }
  .warn {
    background: var(--conflict-bg);
  }
  .ok {
    background: #bbf7d0;
    color: #14532d;
  }
  .targets {
    display: flex;
    flex-direction: column;
    font-size: 0.78rem;
    margin-bottom: 0.25rem;
  }
  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.25rem;
  }
  .action {
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.15rem 0.3rem;
    cursor: pointer;
  }
  .action.on {
    background: var(--accent);
    color: white;
  }
  kbd {
    font-size: 0.65rem;
    opacity: 0.7;
  }
  .notes,
  .raw {
    font-size: 0.72rem;
    white-space: pre-wrap;
    margin: 0;
  }
  .warn-text {
    font-size: 0.78rem;
    color: var(--warn-fg);
  }
  .err-text {
    font-size: 0.78rem;
    color: var(--err-fg);
  }
  .ok-text {
    font-size: 0.78rem;
    color: var(--ok-fg);
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    text-align: left;
    font-size: 0.78rem;
  }
  .move {
    display: block;
    font-size: 0.78rem;
    margin-top: 0.25rem;
  }
</style>
