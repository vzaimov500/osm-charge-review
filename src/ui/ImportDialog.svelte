<script lang="ts">
  import { fmtDateTime } from './format'
  import { t } from './i18n'
  import type { AppState } from './state.svelte'

  let { app }: { app: AppState } = $props()
</script>

{#if app.pendingImport}
  {@const p = app.pendingImport}
  <div class="dialog" role="dialog" aria-label={t('backup.previewTitle', { name: p.name })}>
    <strong>{t('backup.previewTitle', { name: p.name })}</strong>
    <p>{t('backup.preview', { at: fmtDateTime(p.file.exported_at), tool: p.file.tool })}</p>
    <section>
      <h3>{t('backup.mergeTitle')}</h3>
      <p>
        {t('backup.merge', {
          decisions: p.plan.write.decision,
          kept: p.restorePlan.undoneLocalDecisions,
        })}
      </p>
      <button type="button" onclick={() => void app.confirmStateImport('merge')}
        >{t('backup.confirm')}</button
      >
    </section>
    <section>
      <h3>{t('backup.restoreTitle')}</h3>
      <p>{t('backup.restore', { undone: p.restorePlan.undoneLocalDecisions })}</p>
      {#if p.restorePlan.keptUploadedDecisions > 0}
        <p>{t('backup.restoreUploaded', { n: p.restorePlan.keptUploadedDecisions })}</p>
      {/if}
      <button type="button" onclick={() => void app.confirmStateImport('restore')}
        >{t('backup.restoreConfirm')}</button
      >
    </section>
    <button type="button" onclick={() => (app.pendingImport = null)}>{t('loader.cancel')}</button>
  </div>
{/if}

<style>
  section {
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
    margin-top: 0.5rem;
  }
  h3 {
    margin: 0 0 0.25rem;
    font-size: 0.95rem;
  }
  section p {
    margin: 0 0 0.4rem;
    font-size: 0.85rem;
  }
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
    max-width: 36rem;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.25);
  }
</style>
