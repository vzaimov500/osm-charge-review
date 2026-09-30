<script lang="ts">
  import { onMount } from 'svelte'
  import DatasetLoader from './ui/DatasetLoader.svelte'
  import Detail from './ui/Detail.svelte'
  import FilterBar from './ui/FilterBar.svelte'
  import { t } from './ui/i18n'
  import ImportDialog from './ui/ImportDialog.svelte'
  import LiveGate from './ui/LiveGate.svelte'
  import ReviewTable from './ui/ReviewTable.svelte'
  import { AppState } from './ui/state.svelte'
  import StatsPanel from './ui/StatsPanel.svelte'
  import StatusLine from './ui/StatusLine.svelte'
  import TopBar from './ui/TopBar.svelte'
  import UploadPanel from './ui/UploadPanel.svelte'

  const app = new AppState()
  let showStats = $state(false)
  // Narrow windows: the filters slide over the list instead of taking a column.
  let filtersOpen = $state(false)

  onMount(() => {
    void app.init()
  })

  // Information fades after a while; errors and export prompts stay until dismissed.
  $effect(() => {
    const n = app.notice
    if (!n || n.kind !== 'info' || n.exportPrompt) return
    const id = setTimeout(() => {
      if (app.notice === n) app.notice = null
    }, 8000)
    return () => clearTimeout(id)
  })

  const ds = $derived(app.dataset)
</script>

<div class="app">
  <TopBar {app} onstats={() => (showStats = !showStats)} />

  {#if app.fatal}
    <main class="fatal" role="alert">{app.fatal}</main>
  {:else}
    {#if app.ready}<StatusLine {app} />{/if}
    {#if app.showLiveGate}<LiveGate {app} />{/if}
    <ImportDialog {app} />
    {#if app.showUpload && ds}<UploadPanel {app} />{/if}

    {#if (!ds && app.ready) || app.pending}
      <DatasetLoader {app} />
    {/if}
    {#if showStats && ds}<StatsPanel {app} />{/if}
    {#if ds}
      <!-- Filters · list · the selected station. j / k walk the list; the detail follows. -->
      <div class="work">
        <FilterBar {app} open={filtersOpen} onclose={() => (filtersOpen = false)} />
        <ReviewTable {app} onfilters={() => (filtersOpen = !filtersOpen)} />
        {#if app.visible[app.focused]}
          <Detail row={app.visible[app.focused]!} {app} />
        {:else}
          <p class="empty">{t('detail.none')}</p>
        {/if}
      </div>
    {:else}
      <main>
        <p>{t('app.tagline')}</p>
      </main>
    {/if}
  {/if}

  {#if app.notice}
    <div class="toast {app.notice.kind}" role={app.notice.kind === 'error' ? 'alert' : 'status'}>
      <span>{app.notice.text}</span>
      {#if app.notice.exportPrompt}
        <button type="button" onclick={() => void app.exportNow()}>{t('backup.export')}</button>
      {/if}
      <button type="button" aria-label={t('toast.close')} onclick={() => (app.notice = null)}
        >×</button
      >
    </div>
  {/if}

  <footer>
    <span>{t('app.disclaimer')}</span>
    <span class="keys">{t('keys.help')}</span>
  </footer>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
  }
  footer {
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    padding: 0.25rem 0.9rem;
    font-size: 0.7rem;
    opacity: 0.75;
    border-top: 1px solid var(--border);
  }
  .toast {
    position: fixed;
    right: 1rem;
    top: 5.2rem;
    z-index: 1800;
    max-width: 34rem;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
    font-size: 0.85rem;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
    border: 1px solid var(--border);
  }
  .toast.error {
    background: var(--conflict-bg);
  }
  .toast.info {
    background: var(--add-bg);
  }
  .fatal {
    margin: 2rem;
    padding: 1rem;
    background: var(--conflict-bg);
    border-radius: 8px;
  }
  main {
    padding: 0 0.9rem;
    flex: 1;
  }
  .work {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 13rem clamp(16rem, 24vw, 24rem) minmax(0, 1fr);
    overflow: hidden;
    position: relative;
  }
  @media (max-width: 1100px) {
    .work {
      grid-template-columns: clamp(14rem, 34vw, 22rem) minmax(0, 1fr);
    }
  }
  @media (max-width: 700px) {
    .work {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(9rem, 35%) minmax(0, 1fr);
    }
  }
  footer {
    flex-wrap: wrap;
  }
  footer span {
    flex: 1 1 22rem;
  }
  footer .keys {
    text-align: right;
  }
  .empty {
    padding: 2rem;
    opacity: 0.7;
  }
</style>
