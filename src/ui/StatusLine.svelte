<script lang="ts">
  import { fmtDateTime } from './format'
  import { t } from './i18n'
  import type { AppState } from './state.svelte'

  let { app }: { app: AppState } = $props()
  const ds = $derived(app.dataset)
  const info = $derived(app.exportInfo)
  const stale = $derived(info.decisionsSince > 0)
  const total = $derived(app.rows.length)
  const pct = $derived(total ? Math.round((100 * app.reviewedCount) / total) : 0)
</script>

<!-- The state of the work in one line: data, OSM data, regions, licence, progress, backup. -->
<div class="status">
  {#if ds}
    <span
      ><strong>{total}</strong>
      {t('status.candidates', { at: fmtDateTime(ds.info.retrieved_at) })}</span
    >
    <span class="osm">
      {#if app.busy}<em>{app.busy}</em>
      {:else if app.osmMeta}
        {t('osm.fetchedAt', { at: fmtDateTime(app.osmMeta.fetchedAt), count: app.osmMeta.count })}
        <button type="button" onclick={() => void app.fetchOsm(true)}>{t('osm.refetch')}</button>
      {:else}
        <button type="button" class="primary" onclick={() => void app.fetchOsm(false)}
          >{t('osm.fetch')}</button
        >
      {/if}
    </span>
    {#if app.regionNames.length}
      <span>{t('status.regions', { n: app.regionNames.length })}</span>
    {:else if !app.busy}
      <!-- Independent of the station data: boundaries always come from live OSM. -->
      <button type="button" title={t('regions.hint')} onclick={() => void app.loadRegions()}
        >{t('regions.load')}</button
      >
    {/if}
    {#if ds.info.licence_status !== 'compatible'}
      <span class="chip" title={t('dataset.licenceUnverified')}
        >{t('status.licence', { licence: ds.info.licence })}</span
      >
    {/if}
    <span class="spacer"></span>
    <span class="progress">
      {t('status.reviewed')}
      <span class="bar" aria-hidden="true"><span style:width="{pct}%"></span></span>
      <strong>{app.reviewedCount}</strong>
      {t('status.of', { n: total })}
    </span>
  {:else}
    <span class="spacer"></span>
  {/if}
  <span class="backup" class:stale>
    {info.lastExportAt
      ? t('backup.last', { at: fmtDateTime(info.lastExportAt) })
      : t('backup.never')}
    {#if stale}<strong>· {t('backup.since', { n: info.decisionsSince })}</strong>{/if}
    <button type="button" onclick={() => void app.exportNow()}>{t('backup.export')}</button>
  </span>
</div>

<style>
  .status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 1.1rem;
    padding: 0.3rem 0.9rem;
    font-size: 0.78rem;
    background: var(--bar-bg);
    border-bottom: 1px solid var(--border);
  }
  .spacer {
    flex: 1;
  }
  .chip {
    background: var(--sandbox-bg);
    color: var(--sandbox-fg);
    border-radius: 999px;
    padding: 0.05rem 0.55rem;
    font-weight: 500;
  }
  .progress {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .bar {
    width: 9rem;
    height: 6px;
    border-radius: 3px;
    background: var(--muted-bg);
    overflow: hidden;
    display: inline-block;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--primary-bg);
  }
  .stale {
    color: var(--warn-fg);
  }
  .primary {
    font-weight: 600;
    background: var(--primary-bg);
    color: var(--primary-fg);
    border: 1px solid var(--primary-bg);
    border-radius: 6px;
    cursor: pointer;
  }
</style>
