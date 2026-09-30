<script lang="ts">
  import { MATCH_CLASSES } from '../match'
  import { ACTIONS, DEFAULT_FILTERS, DISTANCE_BANDS } from '../review'
  import { t } from './i18n'
  import type { AppState } from './state.svelte'

  let {
    app,
    open = false,
    onclose,
  }: { app: AppState; open?: boolean; onclose?: () => void } = $props()
  const f = $derived(app.filters)

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
  }

  $effect(() => {
    void JSON.stringify(app.filters)
    app.syncUrl()
  })
</script>

<!-- Filters in one column: what is shown in the list. The URL keeps them, so a view can be bookmarked. -->
<aside class="filters" class:open aria-label={t('filters.title')}>
  <button type="button" class="close" onclick={() => onclose?.()}>{t('filters.hide')} ×</button>
  <fieldset>
    <legend>{t('filters.class')}</legend>
    {#each MATCH_CLASSES as c (c)}
      <label title={t(`class.${c}`)}
        ><input
          type="checkbox"
          checked={f.classes.includes(c)}
          onchange={() => (app.filters.classes = toggle(f.classes, c))}
        />
        <span class="dot dot-{c}"></span>{c}<small>{app.stats.byClass[c]}</small></label
      >
    {/each}
  </fieldset>
  <label class="field">
    {t('filters.decided')}
    <select bind:value={app.filters.decided}>
      <option value="all">all</option><option value="undecided">undecided</option><option
        value="decided">decided</option
      ><option value="superseded">superseded</option>
    </select>
  </label>
  <fieldset>
    <legend>{t('filters.action')}</legend>
    {#each ACTIONS as a (a)}
      <label
        ><input
          type="checkbox"
          checked={f.actions.includes(a)}
          onchange={() => (app.filters.actions = toggle(f.actions, a))}
        />
        {a}</label
      >
    {/each}
  </fieldset>
  <label class="field">
    {t('filters.change')}
    <select bind:value={app.filters.change}>
      <option value="all">all</option><option value="update_needed">update needed</option><option
        value="noop">no-op (already correct)</option
      >
    </select>
  </label>
  <fieldset>
    <legend>{t('filters.distance')}</legend>
    {#each DISTANCE_BANDS as b (b)}
      <label
        ><input
          type="checkbox"
          checked={f.distance.includes(b)}
          onchange={() => (app.filters.distance = toggle(f.distance, b))}
        />
        {b}</label
      >
    {/each}
  </fieldset>
  {#if app.regionNames.length}
    <label class="field">
      {t('filters.region')}
      <select bind:value={app.filters.region}>
        <option value="">all</option>
        {#each app.regionNames as r (r)}<option value={r}>{r}</option>{/each}
      </select>
    </label>
  {/if}
  <label
    ><input type="checkbox" bind:checked={app.filters.warningsOnly} />
    {t('filters.warnings')}</label
  >
  <button type="button" onclick={() => (app.filters = { ...DEFAULT_FILTERS })}
    >{t('filters.reset')}</button
  >
</aside>

<style>
  .filters {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 0.7rem 0.8rem;
    border-right: 1px solid var(--border);
    background: var(--bar-bg);
    font-size: 0.82rem;
    overflow-y: auto;
    min-height: 0;
  }
  .close {
    display: none;
  }
  /* Narrow windows: a drawer over the list, opened from the list's Filters button. */
  @media (max-width: 1100px) {
    .filters {
      display: none;
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      width: 15rem;
      z-index: 1000;
      box-shadow: 4px 0 18px rgb(0 0 0 / 0.18);
    }
    .filters.open {
      display: flex;
    }
    .close {
      display: block;
      align-self: flex-end;
    }
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  legend,
  .field {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.8;
    margin-bottom: 0.2rem;
    padding: 0;
  }
  .field {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.25rem;
  }
  .field select {
    text-transform: none;
    letter-spacing: normal;
    width: 100%;
    font-size: 0.82rem;
  }
  label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  small {
    margin-left: auto;
    opacity: 0.6;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    display: inline-block;
  }
  .dot-linked {
    background: #1e7a70;
  }
  .dot-probable {
    background: #2f62c9;
  }
  .dot-possible {
    background: #c0671c;
  }
  .dot-none {
    background: #9a978f;
  }
  .dot-lifecycle {
    background: #7b45ae;
  }
</style>
