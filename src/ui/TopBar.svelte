<script lang="ts">
  import { TARGETS, type ApiTarget } from '../osm/transport/api'
  import { TOOL_NAME, TOOL_VERSION } from '../version'
  import { t } from './i18n'
  import Menu from './Menu.svelte'
  import type { AppState } from './state.svelte'

  let { app, onstats }: { app: AppState; onstats: () => void } = $props()
  let fileInput = $state<HTMLInputElement>()
  const env = $derived(app.target)
  const clientId = $derived(app.clientIds[env])
  const host = (url: string) => new URL(url).host
</script>

<!-- One bar: what is loaded, where it reads and writes, who is signed in, and the next big action. -->
<header class="top">
  <h1>{TOOL_NAME}</h1>
  <span class="version">v{TOOL_VERSION}</span>
  {#if app.datasets.length}
    <select
      aria-label={t('dataset.pick')}
      value={app.dataset?.datasetId}
      onchange={(e) => void app.selectDataset(e.currentTarget.value)}
    >
      {#each app.datasets as d (d.datasetId)}<option value={d.datasetId}
          >{d.info.dataset_name}</option
        >{/each}
    </select>
    <!-- Opens the file picker directly; the loader panel only appears if the file needs attention. -->
    <input
      bind:this={fileInput}
      type="file"
      data-testid="candidate-file-header"
      accept=".json,.geojson,application/geo+json,application/json"
      hidden
      onchange={(e) => {
        const f = e.currentTarget.files?.[0]
        e.currentTarget.value = ''
        if (f) void app.readFile(f)
      }}
    />
    <button type="button" onclick={() => fileInput?.click()}>{t('dataset.loadAnother')}</button>
  {/if}

  <span class="spacer"></span>

  <div class="env env-{env}" role="radiogroup" aria-label={t('env.title')}>
    {#each ['sandbox', 'live'] as const as e (e)}
      <label class:on={env === e}>
        <input
          type="radio"
          name="environment"
          checked={env === e}
          onchange={() => void app.setEnvironment(e as ApiTarget)}
        />
        {t(e === 'sandbox' ? 'env.sandbox' : 'env.live')}
      </label>
    {/each}
  </div>
  <span class="rw">
    {#if env === 'sandbox'}
      {t('env.rwSandbox')}
    {:else if app.liveUnlocked}
      <strong class="live">{t('env.rwLiveUnlocked')}</strong>
    {:else}
      {t('env.rwLiveLocked')}
      <button type="button" onclick={() => (app.showLiveGate = true)}>{t('env.unlock')}</button>
    {/if}
  </span>

  <span class="spacer"></span>

  {#if app.account}
    <span
      class="account"
      title={t('env.signedInAs', { account: app.account, server: host(TARGETS[env].authUrl) })}
      >{app.account}</span
    >
    <button type="button" onclick={() => app.signOutClick()}>{t('upload.signOut')}</button>
  {:else}
    <button
      type="button"
      disabled={!clientId}
      title={clientId ? '' : t('env.noClientId')}
      onclick={() => app.signInClick()}
      >{t('env.signIn', { server: host(TARGETS[env].authUrl) })}</button
    >
  {/if}
  {#if app.dataset}
    <button
      type="button"
      class="primary"
      aria-expanded={app.showUpload}
      onclick={() => (app.showUpload = !app.showUpload)}
      >{t('batch.upload', { n: app.readyCount })}</button
    >
  {/if}
  <Menu {app} {onstats} />
</header>

<style>
  .top :global(button),
  .top label,
  .top select {
    white-space: nowrap;
  }
  .top select {
    max-width: 16rem;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.9rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.85rem;
    background: var(--bg);
  }
  h1 {
    font-size: 1.05rem;
    margin: 0 0.4rem 0 0;
    white-space: nowrap;
  }
  .version {
    font-size: 0.7rem;
    opacity: 0.6;
    margin-right: 0.4rem;
  }
  .spacer {
    flex: 1;
  }
  .env {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .env label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.8rem;
    cursor: pointer;
  }
  .env label + label {
    border-left: 1px solid var(--border);
  }
  .env-sandbox label.on {
    background: var(--sandbox-bg);
    color: var(--sandbox-fg);
    font-weight: 600;
  }
  .env-live label.on {
    background: var(--live-bg);
    color: var(--live-fg);
    font-weight: 600;
  }
  .rw {
    font-size: 0.78rem;
    opacity: 0.85;
    white-space: nowrap;
  }
  .live {
    color: var(--err-fg);
  }
  .account {
    font-weight: 600;
  }
  .primary {
    font-weight: 600;
    background: var(--primary-bg);
    color: var(--primary-fg);
    border: 1px solid var(--primary-bg);
    border-radius: 6px;
    padding: 0.3rem 0.8rem;
    cursor: pointer;
  }
</style>
