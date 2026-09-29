<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual'
  import { get } from 'svelte/store'
  import { SORT_KEYS, statusCode } from '../review'
  import * as act from './actions'
  import { fmtDistance } from './format'
  import { t } from './i18n'
  import type { AppState } from './state.svelte'

  let { app }: { app: AppState } = $props()

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
        if (row) void act.andAdvance(app, row, act.update(app, row))
        break
      case 'Digit2':
      case 'Numpad2':
        if (row) void act.andAdvance(app, row, act.add(app, row))
        break
      case 'Digit3':
      case 'Numpad3':
        if (row) app.rejectRequest = row.candidate.sourceId
        break
      case 'Digit4':
      case 'Numpad4':
        if (row) void act.andAdvance(app, row, act.skip(app, row))
        break
      default:
        return
    }
    e.preventDefault()
  }

  const LEGEND = 'M match · D decision · B batch/upload · ! needs a look'
</script>

<svelte:window {onkeydown} />

<section class="list" aria-label={t('list.title')}>
  <div class="tools">
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
  <div class="legend">
    <div><b>M</b> L linked · P probable · ? possible · N new · X lifecycle</div>
    <div>
      <b>D</b> A add · U update · R reject · S skip &nbsp; <b>B</b> b batch · u uploaded · v verified
    </div>
    <div>
      <b>!</b> needs a decision (conflict, note, lifecycle…) · * changed by the provider · - nothing yet
    </div>
  </div>
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
  .li.sel {
    background: var(--decided-bg);
    box-shadow: inset 3px 0 0 var(--primary-bg);
    font-weight: 600;
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
    padding: 0.4rem 0.7rem;
    border-top: 1px solid var(--border);
    font-size: 0.7rem;
    line-height: 1.45;
    opacity: 0.85;
    background: var(--bar-bg);
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
