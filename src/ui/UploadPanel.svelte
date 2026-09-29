<script lang="ts">
  import { redirectUri } from '../osm/auth'
  import { TARGETS } from '../osm/transport/api'
  import { fmtDateTime } from './format'
  import { t } from './i18n'
  import LiveGate from './LiveGate.svelte'
  import type { AppState } from './state.svelte'

  let { app }: { app: AppState } = $props()
  const cfg = $derived(TARGETS[app.target])
  const clientId = $derived(app.clientIds[app.target])
  let now = $state(Date.now())
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(id)
  })
  const waitS = $derived((void now, app.pacingWaitS))
</script>

<section class="upload" aria-label={t('upload.title')}>
  <header>
    <h2>{t('upload.title')}</h2>
    <label>
      {t('upload.target')}
      <select
        value={app.target}
        onchange={(e) => {
          const v = e.currentTarget.value
          e.currentTarget.value = app.target // nothing switches until the gate says so
          if (v === 'live') app.showLiveGate = true
          else void app.switchToSandbox()
        }}
      >
        <option value="sandbox">{TARGETS.sandbox.label}</option>
        <option value="live">{TARGETS.live.label}</option>
      </select>
    </label>
    {#if app.target === 'live'}<strong class="live">LIVE · {t('live.firstBatch')}</strong>{/if}
    <button type="button" class="close" onclick={() => (app.showUpload = false)}>×</button>
  </header>

  <div class="auth">
    {#if !clientId}
      <p>
        {t('upload.register', {
          url: `${cfg.authUrl}/oauth2/applications/new`,
          redirect: redirectUri(),
        })}
      </p>
    {/if}
    <label>
      {t('upload.clientId')}
      <input
        type="text"
        value={clientId}
        size="46"
        onchange={(e) => void app.setClientId(app.target, e.currentTarget.value)}
      />
    </label>
    {#if app.account}
      <span>{t('upload.signedInAs', { account: app.account })}</span>
      <button type="button" onclick={() => app.signOutClick()}>{t('upload.signOut')}</button>
    {:else}
      <button type="button" disabled={!clientId} onclick={() => app.signInClick()}
        >{t('upload.signIn')}</button
      >
    {/if}
  </div>

  <div class="plan">
    <button type="button" onclick={() => void app.planBatches()}>{t('upload.plan')}</button>
    <button type="button" onclick={() => void app.exportAudit()}>{t('audit.export')}</button>
    {#if app.sessionBatches >= app.sessionCap}<span class="wait"
        >{t('upload.cap', { n: app.sessionCap })}</span
      >{/if}
    {#if waitS > 0}<span class="wait">{t('upload.pacing', { s: waitS })}</span>{/if}
  </div>

  {#if app.batches.length === 0}
    <p>{t('upload.none')}</p>
  {:else}
    <table>
      <tbody>
        {#each app.batches as b (b.id)}
          <tr class="status-{b.status}">
            <td>{fmtDateTime(b.createdAt)}</td>
            <!-- The comment actually sent, once the changeset is open; the plan's until then. -->
            <td>{b.changesetTags?.comment ?? b.comment}</td>
            <td>{b.items.length}</td>
            <td>
              <strong>{b.status}</strong>
              {#if b.changesetId}
                · <a
                  href={`${cfg.authUrl}/changeset/${b.changesetId}`}
                  target="_blank"
                  rel="noopener">changeset {b.changesetId}</a
                >
              {/if}
              {#if b.status === 'in_flight'}<br /><small
                  >{t('upload.inFlight', { step: b.step ?? '', error: b.error ?? '' })}</small
                >{/if}
              {#if b.status === 'failed' && b.error}<br /><small>{b.error}</small>{/if}
            </td>
            <td class="acts">
              {#if b.status === 'draft'}
                <button type="button" onclick={() => void app.dryRun(b)}
                  >{t('upload.dryRun')}</button
                >
                <button
                  type="button"
                  title={app.target === 'live' && !b.dryRunAt ? t('live.needsDryRun') : ''}
                  disabled={(app.target === 'live' && !b.dryRunAt) ||
                    !app.account ||
                    !!app.busy ||
                    waitS > 0 ||
                    app.sessionBatches >= app.sessionCap}
                  onclick={() => void app.uploadBatch(b)}
                >
                  {t('upload.upload', { target: app.target })}
                </button>
                <button type="button" onclick={() => void app.discardBatch(b)}
                  >{t('upload.discard')}</button
                >
              {:else if b.status === 'in_flight' && b.step !== 'verify'}
                <button type="button" disabled={!!app.busy} onclick={() => void app.recover(b)}
                  >{t('upload.recover')}</button
                >
              {:else if b.status === 'verified' || (b.status === 'in_flight' && b.step === 'verify')}
                <button type="button" disabled={!!app.busy} onclick={() => void app.verify(b)}
                  >{t('verify.verify')}</button
                >
                <button
                  type="button"
                  disabled={!app.account || !!app.busy}
                  onclick={() => void app.planRevert(b)}>{t('revert.revert')}</button
                >
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

{#if app.showLiveGate}<LiveGate {app} />{/if}

{#if app.pendingRevert}
  {@const r = app.pendingRevert}
  <div class="dialog" role="dialog" aria-label={t('revert.title')}>
    <strong>{t('revert.title')}</strong>
    <p>
      {t('revert.plan', {
        restore: r.plan.items.filter((i) => i.kind === 'restore').length,
        delete: r.plan.items.filter((i) => i.kind === 'delete').length,
      })}
    </p>
    {#if r.plan.manual.length}
      <p>{t('revert.manual')}</p>
      <ul>
        {#each r.plan.manual as m (m.object)}<li>{m.object} ({m.sourceId}): {m.reason}</li>{/each}
      </ul>
    {/if}
    <button
      type="button"
      disabled={r.plan.items.length === 0}
      onclick={() => void app.confirmRevert()}>{t('revert.confirm')}</button
    >
    <button type="button" onclick={() => (app.pendingRevert = null)}>{t('loader.cancel')}</button>
  </div>
{/if}

<style>
  .dialog {
    position: fixed;
    top: 4rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    z-index: 2000;
    max-width: 40rem;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.25);
  }
  .upload {
    border-bottom: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
    font-size: 0.82rem;
    max-height: 45vh;
    overflow: auto;
  }
  header {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
  }
  h2 {
    font-size: 1rem;
    margin: 0;
  }
  .close {
    margin-left: auto;
  }
  .auth,
  .plan {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
    margin: 0.4rem 0;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  td {
    border-top: 1px solid var(--border);
    padding: 0.25rem 0.4rem;
    vertical-align: top;
  }
  .acts {
    white-space: nowrap;
  }
  .status-failed {
    background: var(--conflict-bg);
  }
  .status-in_flight {
    background: var(--change-bg);
  }
  .live {
    color: var(--err-fg);
  }
  .wait {
    color: var(--warn-fg);
  }
</style>
