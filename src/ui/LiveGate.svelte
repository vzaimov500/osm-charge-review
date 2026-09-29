<script lang="ts">
  import { TARGETS } from '../osm/transport/api'
  import {
    CHECKLIST,
    confirmsLive,
    waitingDaysLeft,
    type ChecklistItem,
    type GateProblem,
  } from '../review'
  import { t, type MessageKey } from './i18n'
  import type { AppState } from './state.svelte'

  let { app }: { app: AppState } = $props()
  let typed = $state('')
  const s = $derived(app.liveSettings)
  const problems = $derived(app.liveProblems)
  const canSwitch = $derived(problems.length === 0 && !!app.liveAccount && confirmsLive(typed))

  const problemText = (p: GateProblem): string =>
    p === 'waiting_period'
      ? t('live.p.waiting_period', { days: waitingDaysLeft(s.forumPostedOn, Date.now()) })
      : t(`live.p.${p}` as MessageKey)
  const checkText = (c: ChecklistItem): string => t(`live.c.${c}` as MessageKey)
</script>

<div class="gate" role="dialog" aria-label={t('live.title')}>
  <h2>{t('live.title')}</h2>
  <p>{t('live.intro')}</p>

  <label
    >{t('live.wiki')}
    <input
      type="url"
      value={s.wikiUrl}
      size="60"
      onchange={(e) => void app.saveLiveSettings({ wikiUrl: e.currentTarget.value })}
    /></label
  >
  <label
    >{t('live.forum')}
    <input
      type="url"
      value={s.forumUrl}
      size="60"
      onchange={(e) => void app.saveLiveSettings({ forumUrl: e.currentTarget.value })}
    /></label
  >
  <label
    >{t('live.posted')}
    <input
      type="date"
      value={s.forumPostedOn}
      onchange={(e) => void app.saveLiveSettings({ forumPostedOn: e.currentTarget.value })}
    /></label
  >

  <fieldset>
    <legend>{t('live.checklist')}</legend>
    {#each CHECKLIST as c (c)}
      <label class="check">
        <input
          type="checkbox"
          checked={s.checklist[c] === true}
          onchange={(e) =>
            void app.saveLiveSettings({
              checklist: { ...s.checklist, [c]: e.currentTarget.checked },
            })}
        />
        {checkText(c)}
      </label>
    {/each}
  </fieldset>

  <label>
    {t('live.clientId')}
    <input
      type="text"
      value={app.clientIds.live}
      size="46"
      onchange={(e) => void app.setClientId('live', e.currentTarget.value)}
    />
  </label>

  {#if problems.length}
    <div class="problems" role="alert">
      <strong>{t('live.blocked')}</strong>
      <ul>
        {#each problems as p (p)}<li data-problem={p}>{problemText(p)}</li>{/each}
      </ul>
    </div>
  {:else}
    <div class="confirm">
      <p>{t('live.apiUrl')} <code>{TARGETS.live.apiUrl}</code></p>
      {#if app.liveAccount}
        <p>{t('live.account')} <strong>{app.liveAccount}</strong></p>
      {:else}
        <button type="button" onclick={() => app.liveSignInClick()}>{t('live.signIn')}</button>
      {/if}
      <label>{t('live.type')} <input type="text" bind:value={typed} autocomplete="off" /></label>
    </div>
  {/if}

  <div class="buttons">
    <button
      type="button"
      class="danger"
      disabled={!canSwitch}
      onclick={() => void app.switchToLive(typed)}>{t('live.switch')}</button
    >
    <button type="button" onclick={() => (app.showLiveGate = false)}>{t('loader.cancel')}</button>
  </div>
</div>

<style>
  .gate {
    position: fixed;
    top: 3rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg);
    border: 2px solid var(--err-fg);
    border-radius: 8px;
    padding: 1rem 1.25rem;
    z-index: 2100;
    width: min(46rem, 94vw);
    max-height: 88vh;
    overflow: auto;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.3);
    font-size: 0.85rem;
  }
  h2 {
    margin: 0 0 0.5rem;
    color: var(--err-fg);
  }
  label {
    display: block;
    margin: 0.35rem 0;
  }
  .check {
    margin: 0.15rem 0;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: 6px;
    margin: 0.5rem 0;
  }
  .problems {
    background: var(--conflict-bg);
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
  }
  .buttons {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .danger:enabled {
    background: var(--err-fg);
    color: white;
  }
</style>
