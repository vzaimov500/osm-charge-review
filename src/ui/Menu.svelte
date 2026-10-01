<script lang="ts">
  import { OVERPASS_ENDPOINTS } from '../osm/transport/overpass'
  import { t } from './i18n'
  import type { AppState } from './state.svelte'

  let { app, onstats }: { app: AppState; onstats: () => void } = $props()
  let importInput: HTMLInputElement
  const host = (url: string) => new URL(url).host
</script>

<!-- Settings and rarely used actions, in one place. <details> keeps the inputs in the page when closed. -->
<details class="menu">
  <summary aria-label={t('menu.title')} title={t('menu.title')}>⋯</summary>
  <div class="panel">
    <section>
      <h2>{t('menu.data')}</h2>
      {#if app.dataset}<button type="button" onclick={onstats}>{t('stats.show')}</button>{/if}
      <button type="button" onclick={() => importInput.click()}>{t('backup.import')}</button>
      <input
        bind:this={importInput}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="state-import"
        onchange={(e) => {
          const f = e.currentTarget.files?.[0]
          if (f) void app.readStateImport(f)
          e.currentTarget.value = ''
        }}
      />
      {#if app.storage}
        <p>
          {app.storage.persisted ? t('storage.persisted') : t('storage.notPersisted')}
          {#if !app.storage.persisted}
            <button type="button" onclick={() => void app.persist()}>{t('storage.ask')}</button>
          {/if}
        </p>
      {/if}
    </section>
    <section>
      <h2>{t('env.endpoint')}</h2>
      <p>{t('menu.overpassHint')}</p>
      <select bind:value={app.endpoint} aria-label={t('env.endpoint')}>
        {#each OVERPASS_ENDPOINTS as e (e)}<option value={e}>{host(e)}</option>{/each}
      </select>
    </section>
  </div>
</details>

<style>
  .menu {
    position: relative;
  }
  summary {
    list-style: none;
    cursor: pointer;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.15rem 0.6rem;
    font-weight: 700;
    user-select: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .panel {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 1500;
    width: 26rem;
    max-width: calc(100vw - 2rem);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.2);
    padding: 0.4rem 0.9rem;
    font-size: 0.82rem;
  }
  section {
    padding: 0.5rem 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }
  section + section {
    border-top: 1px solid var(--border);
  }
  h2 {
    width: 100%;
    margin: 0;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.7;
  }
  p {
    margin: 0;
    width: 100%;
  }
</style>
