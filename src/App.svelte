<script lang="ts">
  import { onMount } from 'svelte'
  import BackupControls from './ui/BackupControls.svelte'
  import BatchBar from './ui/BatchBar.svelte'
  import DatasetLoader from './ui/DatasetLoader.svelte'
  import FilterBar from './ui/FilterBar.svelte'
  import { fmtDateTime } from './ui/format'
  import { t } from './ui/i18n'
  import ReviewTable from './ui/ReviewTable.svelte'
  import { AppState } from './ui/state.svelte'
  import StatsPanel from './ui/StatsPanel.svelte'
  import UploadPanel from './ui/UploadPanel.svelte'
  import { OVERPASS_ENDPOINTS } from './osm/transport/overpass'
  import { TOOL_NAME, TOOL_VERSION } from './version'

  const app = new AppState()
  let showStats = $state(false)
  let showLoader = $state(false)

  onMount(() => {
    void app.init()
  })

  const ds = $derived(app.dataset)
</script>

<div class="app">
  <header>
    <h1>{TOOL_NAME}</h1>
    <span class="version">v{TOOL_VERSION}</span>
    {#if app.datasets.length}
      <label>
        {t('dataset.pick')}
        <select
          value={ds?.datasetId}
          onchange={(e) => void app.selectDataset(e.currentTarget.value)}
        >
          {#each app.datasets as d (d.datasetId)}<option value={d.datasetId}
              >{d.info.dataset_name}</option
            >{/each}
        </select>
      </label>
      <button type="button" onclick={() => (showLoader = !showLoader)}
        >{t('dataset.loadAnother')}</button
      >
      <button type="button" onclick={() => (showStats = !showStats)}>{t('stats.show')}</button>
    {/if}
    {#if app.ready && !app.fatal}<BackupControls {app} />{/if}
    {#if app.storage}
      <span class="storage" class:warnc={!app.storage.persisted}>
        {app.storage.persisted ? t('storage.persisted') : t('storage.notPersisted')}
        {#if !app.storage.persisted}
          <button type="button" onclick={() => void app.persist()}>{t('storage.ask')}</button>
        {/if}
      </span>
    {/if}
  </header>

  {#if app.fatal}
    <main class="fatal" role="alert">{app.fatal}</main>
  {:else}
    {#if app.notice}
      <div class="notice {app.notice.kind}" role={app.notice.kind === 'error' ? 'alert' : 'status'}>
        {app.notice.text}
        {#if app.notice.exportPrompt}
          <button type="button" onclick={() => void app.exportNow()}>{t('backup.export')}</button>
        {/if}
        <button type="button" onclick={() => (app.notice = null)}>×</button>
      </div>
    {/if}

    {#if ds}
      <div class="dsbar">
        <span class="licence" class:bad={ds.info.licence_status !== 'compatible'}>
          {t('dataset.licence')}: <code>{ds.info.licence}</code>
          {#if ds.info.licence_status !== 'compatible'}— {t('dataset.licenceUnverified')}{/if}
        </span>
        <span>{t('dataset.adapter')}: {ds.info.adapter.name} {ds.info.adapter.version}</span>
        <span>{t('dataset.retrieved')}: {fmtDateTime(ds.info.retrieved_at)}</span>
        <span class="osm">
          {#if app.busy}{app.busy}
          {:else if app.osmMeta}{t('osm.fetchedAt', {
              at: fmtDateTime(app.osmMeta.fetchedAt),
              count: app.osmMeta.count,
            })}
            <button type="button" onclick={() => void app.fetchOsm(true)}>{t('osm.refetch')}</button
            >
          {:else}{t('osm.none')}
            <button type="button" onclick={() => void app.fetchOsm(false)}>{t('osm.fetch')}</button
            >{/if}
          <select
            aria-label={t('osm.source')}
            value={app.stationSource === 'sandbox' ? 'sandbox' : app.endpoint}
            onchange={(e) => {
              const v = e.currentTarget.value
              if (v !== 'sandbox') app.endpoint = v
              void app.setStationSource(v === 'sandbox' ? 'sandbox' : 'overpass')
            }}
          >
            {#each OVERPASS_ENDPOINTS as e (e)}<option value={e}>{new URL(e).host}</option>{/each}
            <option value="sandbox">{t('osm.sourceSandbox')}</option>
          </select>
        </span>
      </div>
    {/if}

    {#if (!ds && app.ready) || showLoader || app.pending}
      <DatasetLoader {app} />
    {/if}
    {#if showStats && ds}<StatsPanel {app} />{/if}
    {#if app.showUpload && ds}<UploadPanel {app} />{/if}
    {#if ds}
      <FilterBar {app} />
      <ReviewTable {app} />
      <BatchBar {app} />
    {:else}
      <main>
        <p>{t('app.tagline')}</p>
      </main>
    {/if}
  {/if}

  <p class="disclaimer">{t('app.disclaimer')}</p>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.85rem;
  }
  h1 {
    font-size: 1.1rem;
    margin: 0;
  }
  .version,
  .disclaimer {
    font-size: 0.72rem;
    opacity: 0.7;
  }
  .disclaimer {
    margin: 0;
    padding: 0.2rem 0.75rem;
  }
  .storage {
    margin-left: auto;
    font-size: 0.75rem;
  }
  .warnc {
    color: var(--warn-fg);
  }
  .dsbar {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 0.35rem 0.75rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.8rem;
    align-items: center;
  }
  .licence.bad {
    color: var(--err-fg);
    font-weight: 600;
  }
  .osm {
    margin-left: auto;
  }
  .notice {
    padding: 0.4rem 0.75rem;
    font-size: 0.85rem;
  }
  .notice.error {
    background: var(--conflict-bg);
  }
  .notice.info {
    background: var(--add-bg);
  }
  .fatal {
    margin: 2rem;
    padding: 1rem;
    background: var(--conflict-bg);
    border-radius: 8px;
  }
  main {
    padding: 0 0.75rem;
  }
</style>
