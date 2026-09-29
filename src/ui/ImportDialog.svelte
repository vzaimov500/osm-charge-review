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
    <p>
      {t('backup.preview', {
        at: fmtDateTime(p.file.exported_at),
        tool: p.file.tool,
        decisions: p.plan.write.decision,
        candidates: p.plan.write.candidate,
        events: p.plan.write.event,
        kept: p.plan.keptLocalDecisions,
      })}
    </p>
    <button type="button" onclick={() => void app.confirmStateImport()}
      >{t('backup.confirm')}</button
    >
    <button type="button" onclick={() => (app.pendingImport = null)}>{t('loader.cancel')}</button>
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
    max-width: 36rem;
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.25);
  }
</style>
