<script lang="ts">
  import { MATCH_CLASSES } from '../match'
  import { ACTIONS, DEFAULT_FILTERS, DISTANCE_BANDS, SORT_KEYS } from '../review'
  import { t } from './i18n'
  import type { AppState } from './state.svelte'

  let { app }: { app: AppState } = $props()
  const f = $derived(app.filters)

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
  }

  $effect(() => {
    void JSON.stringify(app.filters)
    app.syncUrl()
  })
</script>

<div class="filters">
  <fieldset>
    <legend>{t('filters.class')}</legend>
    {#each MATCH_CLASSES as c (c)}
      <label
        ><input
          type="checkbox"
          checked={f.classes.includes(c)}
          onchange={() => (app.filters.classes = toggle(f.classes, c))}
        />
        {c} <small>{app.stats.byClass[c]}</small></label
      >
    {/each}
  </fieldset>
  <label>
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
  <label>
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
    <label>
      {t('filters.region')}
      <select bind:value={app.filters.region}>
        <option value="">all</option>
        {#each app.regionNames as r (r)}<option value={r}>{r}</option>{/each}
      </select>
    </label>
  {:else if !app.busy}
    <!-- Independent of the station data: boundaries always come from live OSM. -->
    <button type="button" title={t('regions.hint')} onclick={() => void app.loadRegions()}
      >{t('regions.load')}</button
    >
  {/if}
  <label
    ><input type="checkbox" bind:checked={app.filters.warningsOnly} />
    {t('filters.warnings')}</label
  >
  <input
    id="search"
    type="search"
    placeholder={t('filters.search')}
    bind:value={app.filters.text}
  />
  <label>
    {t('filters.sort')}
    <select bind:value={app.filters.sort}>
      {#each SORT_KEYS as k (k)}<option value={k}>{k}</option>{/each}
    </select>
  </label>
  <label><input type="checkbox" bind:checked={app.filters.desc} /> ↓</label>
  <button type="button" onclick={() => (app.filters = { ...DEFAULT_FILTERS })}
    >{t('filters.reset')}</button
  >
  <span class="count"
    >{t('filters.showing', { shown: app.visible.length, total: app.rows.length })}</span
  >
</div>

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.9rem;
    align-items: center;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.8rem;
  }
  fieldset {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  legend {
    float: left;
    font-weight: 600;
    margin-right: 0.2rem;
  }
  small {
    opacity: 0.6;
  }
  #search {
    min-width: 16rem;
  }
  .count {
    margin-left: auto;
    opacity: 0.8;
  }
</style>
