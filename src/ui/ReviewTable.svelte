<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual'
  import { get } from 'svelte/store'
  import * as act from './actions'
  import type { AppState } from './state.svelte'
  import Row from './Row.svelte'

  let { app }: { app: AppState } = $props()

  const ROW_HEIGHT = 216
  let scroller: HTMLDivElement | undefined = $state()

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLElement>({
    count: 0,
    getScrollElement: () => scroller ?? null,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
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
    const next = Math.min(app.visible.length - 1, Math.max(0, app.focused + delta))
    app.focused = next
    $virtualizer.scrollToIndex(next, { align: 'auto' })
  }

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

  // Keyboard: a/u/r/s set the action on the focused row, j/k move, / focuses search.
  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (isTyping(e)) {
      if (e.key === 'Escape') (e.target as HTMLElement).blur()
      return
    }
    const row = app.visible[app.focused]
    switch (e.key) {
      case 'j':
        move(1)
        break
      case 'k':
        move(-1)
        break
      case '/':
        document.getElementById('search')?.focus()
        break
      case 'a':
        if (row) void act.add(app, row)
        break
      case 'u':
        if (row) void act.update(app, row)
        break
      case 's':
        if (row) void act.skip(app, row)
        break
      case 'r':
        if (row) app.rejectRequest = row.candidate.sourceId
        break
      default:
        return
    }
    e.preventDefault()
  }
</script>

<svelte:window {onkeydown} />

<div class="scroller" bind:this={scroller}>
  <div style:height="{$virtualizer.getTotalSize()}px" style:position="relative">
    {#each $virtualizer.getVirtualItems() as item (app.visible[item.index]?.candidate.sourceId ?? item.key)}
      {@const row = app.visible[item.index]}
      {#if row}
        <div
          class="slot"
          style:transform="translateY({item.start}px)"
          style:height="{ROW_HEIGHT}px"
        >
          <Row
            {row}
            {app}
            focused={item.index === app.focused}
            onfocus={() => (app.focused = item.index)}
          />
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .scroller {
    flex: 1;
    overflow-y: auto;
    contain: strict;
  }
  .slot {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
  }
</style>
