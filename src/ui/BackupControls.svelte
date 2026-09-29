<script lang="ts">
  import { fmtDateTime } from './format'
  import { t } from './i18n'
  import type { AppState } from './state.svelte'

  let { app }: { app: AppState } = $props()
  let input: HTMLInputElement
  const info = $derived(app.exportInfo)
  const stale = $derived(info.decisionsSince > 0)
</script>

<span class="backup" class:stale>
  {info.lastExportAt ? t('backup.last', { at: fmtDateTime(info.lastExportAt) }) : t('backup.never')}
  {#if stale}<strong>· {t('backup.since', { n: info.decisionsSince })}</strong>{/if}
  <button type="button" onclick={() => void app.exportNow()}>{t('backup.export')}</button>
  <button type="button" onclick={() => input.click()}>{t('backup.import')}</button>
  <input
    bind:this={input}
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
</span>

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
  .backup {
    font-size: 0.75rem;
  }
  .stale {
    color: var(--warn-fg);
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
