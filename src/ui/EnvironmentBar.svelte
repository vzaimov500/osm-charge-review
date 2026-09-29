<script lang="ts">
  import { redirectUri } from '../osm/auth'
  import { TARGETS, type ApiTarget } from '../osm/transport/api'
  import { OVERPASS_ENDPOINTS } from '../osm/transport/overpass'
  import { t } from './i18n'
  import type { AppState } from './state.svelte'

  let { app }: { app: AppState } = $props()
  const env = $derived(app.target)
  const clientId = $derived(app.clientIds[env])
  const host = (url: string) => new URL(url).host
</script>

<!-- Where data is read from and where edits are written: one choice, always the same server. -->
<section class="env env-{env}" aria-label={t('env.title')}>
  <div class="switch" role="radiogroup" aria-label={t('env.title')}>
    <strong>{t('env.title')}</strong>
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

  <div class="rw">
    <span>
      {t('env.reads')}
      {#if env === 'sandbox'}
        <strong>{t('env.sandboxServer', { host: host(TARGETS.sandbox.apiUrl) })}</strong>
      {:else}
        <strong>{t('env.liveMap')}</strong>
        <select bind:value={app.endpoint} aria-label={t('env.endpoint')}>
          {#each OVERPASS_ENDPOINTS as e (e)}<option value={e}>{host(e)}</option>{/each}
        </select>
      {/if}
    </span>
    <span>
      {t('env.writes')}
      {#if env === 'sandbox'}
        <strong>{t('env.sandboxServer', { host: host(TARGETS.sandbox.apiUrl) })}</strong>
      {:else if app.liveUnlocked}
        <strong class="live">{t('env.liveUnlocked')}</strong>
      {:else}
        <strong class="locked">{t('env.liveLocked')}</strong>
        <button type="button" onclick={() => (app.showLiveGate = true)}>{t('env.unlock')}</button>
      {/if}
    </span>
    {#if app.dataset}
      <span class="upload">
        {t('batch.pending', { n: app.readyCount })}
        <button type="button" class="primary" onclick={() => (app.showUpload = !app.showUpload)}
          >{app.showUpload ? t('batch.close') : t('batch.apply')}</button
        >
      </span>
    {/if}
    <span>
      {#if app.account}
        {t('env.signedInAs', { account: app.account, server: host(TARGETS[env].authUrl) })}
        <button type="button" onclick={() => app.signOutClick()}>{t('upload.signOut')}</button>
      {:else}
        <button type="button" disabled={!clientId} onclick={() => app.signInClick()}
          >{t('env.signIn', { server: host(TARGETS[env].authUrl) })}</button
        >
        {#if !clientId}<small>{t('env.noClientId')}</small>{/if}
      {/if}
    </span>
  </div>

  <details class="advanced">
    <summary>{t('env.advanced')}</summary>
    {#if !clientId}
      <p>
        {t('upload.register', {
          url: `${TARGETS[env].authUrl}/oauth2/applications/new`,
          redirect: redirectUri(),
        })}
      </p>
    {/if}
    <label>
      {t('env.clientId', { server: host(TARGETS[env].authUrl) })}
      <input
        type="text"
        value={clientId}
        size="46"
        onchange={(e) => void app.setClientId(env, e.currentTarget.value)}
      />
    </label>
  </details>
</section>

<style>
  .env {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 1.25rem;
    padding: 0.35rem 0.75rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.8rem;
  }
  .env-sandbox {
    background: var(--muted-bg);
  }
  .env-live {
    border-bottom: 2px solid var(--err-fg);
  }
  .switch {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .switch label {
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.1rem 0.5rem;
    cursor: pointer;
  }
  .switch label.on {
    border-color: var(--accent);
    font-weight: 600;
  }
  .rw {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.25rem;
    align-items: center;
  }
  .live {
    color: var(--err-fg);
  }
  .primary {
    font-weight: 600;
    border: 1px solid var(--accent);
  }
  .locked {
    color: var(--warn-fg);
  }
  .advanced {
    font-size: 0.75rem;
  }
  .advanced p {
    margin: 0.3rem 0;
    max-width: 60rem;
  }
</style>
