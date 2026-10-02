<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual'
  import { get } from 'svelte/store'
  import { SORT_KEYS, statusCode } from '../review'
  import * as act from './actions'
  import { fmtDistance } from './format'
  import { t } from './i18n'
  import type { AppState } from './state.svelte'

  let { app, onfilters }: { app: AppState; onfilters?: () => void } = $props()

  const ROW_HEIGHT = 30
  let scroller: HTMLDivElement | undefined = $state()

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLElement>({
    count: 0,
    getScrollElement: () => scroller ?? null,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  $effect(() => {
    // Read the store without subscribing: setOptions updates it, and a
    // subscription here would re-run this effect forever.
    const count = app.visible.length
    get(virtualizer).setOptions({ count })
  })

  $effect(() => {
    if (app.focused >= app.visible.length) app.focused = Math.max(0, app.visible.length - 1)
  })

  function move(delta: number) {
    app.focused = Math.min(app.visible.length - 1, Math.max(0, app.focused + delta))
  }

  // Whatever moved the selection (keys, auto-advance, a click), keep it in view.
  $effect(() => {
    const i = app.focused
    if (i < app.visible.length) get(virtualizer).scrollToIndex(i, { align: 'auto' })
  })

  const isTyping = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null
    return (
      !!el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable)
    )
  }

  /**
   * Keys for the left hand while the right one stays on the mouse. Physical
   * positions (KeyboardEvent.code), so they work in any keyboard layout,
   * Cyrillic included: 1–4 decide in button order, W/S move, Q/E jump to the
   * previous/next undecided station, F searches. Arrows move too.
   */
  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (isTyping(e)) {
      if (e.key === 'Escape') (e.target as HTMLElement).blur()
      return
    }
    const row = app.visible[app.focused]
    switch (e.code) {
      case 'KeyS':
      case 'ArrowDown':
        move(1)
        break
      case 'KeyW':
      case 'ArrowUp':
        move(-1)
        break
      case 'KeyE':
        app.jumpUndecided(1)
        break
      case 'KeyQ':
        app.jumpUndecided(-1)
        break
      case 'KeyF':
      case 'Slash':
        document.getElementById('search')?.focus()
        break
      case 'Digit1':
      case 'Numpad1':
        if (row && row.targets.length > 0) void act.update(app, row, act.shownTarget(app, row))
        break
      case 'Digit2':
      case 'Numpad2':
        if (row && row.match.class !== 'linked') void act.add(app, row)
        break
      case 'Digit3':
      case 'Numpad3':
        if (row) app.rejectRequest = row.candidate.sourceId
        break
      case 'Digit4':
      case 'Numpad4':
        if (row) void act.skip(app, row)
        break
      default:
        return
    }
    e.preventDefault()
  }

  const LEGEND = 'M match · D decision · B batch/upload · ! needs a look'

  // Open or folded legend: a per-browser convenience, so storage failures just mean "open".
  const LEGEND_KEY = 'osm-charge-review:legend'
  let legendOpen = $state(readLegendOpen())
  function readLegendOpen(): boolean {
    try {
      return localStorage.getItem(LEGEND_KEY) !== 'closed'
    } catch {
      return true
    }
  }
  $effect(() => {
    const v = legendOpen ? 'open' : 'closed'
    try {
      localStorage.setItem(LEGEND_KEY, v)
    } catch {
      /* private mode: not remembered */
    }
  })

  const LEGEND_ROWS = [
    {
      col: 'M',
      name: 'match',
      values: [
        { char: 'L', cls: 'm-L', text: 'linked' },
        { char: 'P', cls: 'm-P', text: 'probable' },
        { char: '?', cls: 'm-q', text: 'possible' },
        { char: 'N', cls: 'm-N', text: 'new' },
        { char: 'X', cls: 'm-X', text: 'lifecycle' },
      ],
    },
    {
      col: 'D',
      name: 'decision',
      values: [
        { char: 'U', cls: 'd-U', text: 'update' },
        { char: 'A', cls: 'd-A', text: 'add' },
        { char: 'R', cls: 'd-R', text: 'reject' },
        { char: 'S', cls: 'd-S', text: 'skip' },
      ],
    },
    {
      col: 'B',
      name: 'upload',
      values: [
        { char: 'b', cls: 'b-b', text: 'in a batch' },
        { char: 'u', cls: 'b-u', text: 'uploaded' },
        { char: 'v', cls: 'b-v', text: 'verified' },
      ],
    },
    {
      col: '!',
      name: 'attention',
      values: [
        { char: '!', cls: 'a-bang', text: 'needs a look' },
        { char: '*', cls: 'a-star', text: 'changed by provider' },
      ],
    },
  ]
</script>

<svelte:window {onkeydown} />

<section class="list" aria-label={t('list.title')}>
  <div class="tools">
    <button type="button" class="filters-toggle" onclick={() => onfilters?.()}
      >{t('filters.show')}</button
    >
    <input
      id="search"
      type="search"
      placeholder={t('filters.search')}
      bind:value={app.filters.text}
    />
    <select aria-label={t('filters.sort')} bind:value={app.filters.sort}>
      {#each SORT_KEYS as k (k)}<option value={k}>{k}</option>{/each}
    </select>
    <label title={t('list.descending')}
      ><input type="checkbox" bind:checked={app.filters.desc} /> ↓</label
    >
  </div>
  <div class="head" title={LEGEND}>
    <span class="code">MDB!</span><span>{t('list.station')}</span><span class="dist"
      >{t('filters.showing', { shown: app.visible.length, total: app.rows.length })}</span
    >
  </div>
  <div class="scroller" bind:this={scroller} role="listbox" aria-label={t('list.title')}>
    <div style:height="{$virtualizer.getTotalSize()}px" style:position="relative">
      {#each $virtualizer.getVirtualItems() as item (app.visible[item.index]?.candidate.sourceId ?? item.key)}
        {@const row = app.visible[item.index]}
        {#if row}
          {@const s = statusCode(row, app.batchStates.get(row.candidate.sourceId))}
          <!-- Rows are picked by mouse or j/k; the listbox is the keyboard target. -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
          <div
            class="li"
            class:sel={item.index === app.focused}
            role="option"
            aria-selected={item.index === app.focused}
            data-source-id={row.candidate.sourceId}
            data-decision={row.decision?.action ?? ''}
            data-code={s.match + s.decision + s.batch + s.attention}
            style:transform="translateY({item.start}px)"
            onclick={() => (app.focused = item.index)}
          >
            <span class="code"
              ><span class="m-{s.match === '?' ? 'q' : s.match}">{s.match}</span><span
                class="d-{s.decision}">{s.decision}</span
              ><span class="b-{s.batch}">{s.batch}</span><span
                class="a-{s.attention === '*' ? 'star' : s.attention === '!' ? 'bang' : 'none'}"
                >{s.attention}</span
              ></span
            >
            <span class="name">{row.candidate.label ?? row.candidate.sourceId}</span>
            <span class="dist">{row.nearestM !== undefined ? fmtDistance(row.nearestM) : '—'}</span>
          </div>
        {/if}
      {/each}
    </div>
  </div>
  <!-- One row per status letter: its name, then each value as a pill in the list's colours. -->
  <details class="legend" bind:open={legendOpen}>
    <summary>{t('list.legend')}</summary>
    <dl>
      {#each LEGEND_ROWS as r (r.col)}
        <dt><b>{r.col}</b> {r.name}</dt>
        <dd>
          {#each r.values as v (v.char)}<span class="pill"
              ><span class="code {v.cls}">{v.char}</span> {v.text}</span
            >{/each}
        </dd>
      {/each}
    </dl>
    <p class="none-note"><span class="code d--">-</span> {t('list.legendNone')}</p>
  </details>
</section>

<style>
  .list {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--border);
    font-size: 0.85rem;
  }
  .tools {
    display: flex;
    gap: 0.4rem;
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid var(--border);
    align-items: center;
  }
  .filters-toggle {
    display: none;
  }
  @media (max-width: 1100px) {
    .filters-toggle {
      display: inline-block;
    }
  }
  #search {
    flex: 1;
    min-width: 0;
  }
  .head,
  .li {
    display: grid;
    grid-template-columns: 4.2rem minmax(0, 1fr) auto;
    gap: 0.5rem;
    align-items: center;
    padding: 0 0.7rem;
  }
  .head {
    font-size: 0.72rem;
    opacity: 0.75;
    padding-top: 0.25rem;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--border);
    background: var(--bar-bg);
  }
  .scroller {
    flex: 1;
    overflow-y: auto;
    contain: strict;
  }
  .li {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 30px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--muted-bg);
    cursor: pointer;
  }
  /* The open station: a solid band with a thick edge, unmistakable at a glance. */
  .li.sel {
    background: var(--sel-bg);
    box-shadow:
      inset 6px 0 0 var(--primary-bg),
      inset 0 0 0 2px var(--primary-bg);
    font-weight: 700;
  }
  .li.sel .name::before {
    content: '▶ ';
    color: var(--primary-bg);
  }
  .code {
    font-family: ui-monospace, monospace;
    letter-spacing: 0.3em;
    font-weight: 700;
  }
  .name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dist {
    font-size: 0.75rem;
    opacity: 0.75;
    text-align: right;
  }
  .legend {
    padding: 0.35rem 0.7rem 0.45rem;
    border-top: 1px solid var(--border);
    font-size: 0.72rem;
    background: var(--bar-bg);
  }
  .legend summary {
    cursor: pointer;
    opacity: 0.75;
    user-select: none;
  }
  .legend dl {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.3rem 0.6rem;
    margin: 0.35rem 0 0;
    align-items: baseline;
  }
  .legend dt {
    white-space: nowrap;
    opacity: 0.8;
  }
  .legend dt b {
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    display: inline-block;
    width: 0.9rem;
  }
  .legend dd {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .pill {
    display: inline-flex;
    align-items: baseline;
    gap: 0.25rem;
    padding: 0 0.45rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    white-space: nowrap;
  }
  .pill .code {
    letter-spacing: 0;
  }
  .none-note {
    margin: 0.3rem 0 0;
    opacity: 0.75;
  }
  .none-note .code {
    letter-spacing: 0;
    opacity: 0.6;
  }
  @media (max-width: 700px) {
    .legend {
      display: none;
    }
  }
  /* Letters: '-' is quiet, the rest coloured by meaning (lightness differs, not only hue). */
  .d--,
  .b--,
  .a-none {
    opacity: 0.3;
    font-weight: 400;
  }
  .m-L {
    color: #0f5550;
  }
  .m-P {
    color: #1e3a8a;
  }
  .m-q {
    color: #9a4a00;
  }
  .m-N {
    color: #555;
  }
  .m-X {
    color: #55287e;
  }
  .d-U {
    color: #1f5fad;
  }
  .d-A {
    color: #1d6e3f;
  }
  .d-R {
    color: #a3261b;
  }
  .d-S {
    color: #6b6f76;
  }
  .b-b {
    color: #8a5a00;
  }
  .b-u {
    color: #1f5fad;
  }
  .b-v {
    color: #1d6e3f;
  }
  .a-bang {
    color: #c2410c;
  }
  .a-star {
    color: #a3261b;
  }
  @media (prefers-color-scheme: dark) {
    .m-L,
    .b-v,
    .d-A {
      color: #86efac;
    }
    .m-P,
    .d-U,
    .b-u {
      color: #93c5fd;
    }
    .m-q,
    .b-b,
    .a-bang {
      color: #fdba74;
    }
    .m-N,
    .d-S {
      color: #cbd5e1;
    }
    .m-X {
      color: #d8b4fe;
    }
    .d-R,
    .a-star {
      color: #fca5a5;
    }
  }
</style>
