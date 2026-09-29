<script lang="ts">
  import { t } from './i18n'
  import type { AppState } from './state.svelte'

  let { app }: { app: AppState } = $props()
  // Ready: decided add/update, not superseded (decided implies that), not yet uploaded.
  const ready = $derived(
    app.rows.filter(
      (r) =>
        r.decided &&
        !r.decision!.uploadedBatchId &&
        (r.decision!.action === 'add' || r.decision!.action === 'update'),
    ).length,
  )
</script>

<footer class="batchbar">
  <span>{t('batch.pending', { n: ready })}</span>
  <span
    >{t('batch.target', {
      target:
        app.target === 'sandbox'
          ? t('batch.sandbox')
          : app.liveUnlocked
            ? 'LIVE OpenStreetMap'
            : t('batch.liveLocked'),
    })}</span
  >
  <span class="keys">{t('keys.help')}</span>
  <button type="button" onclick={() => (app.showUpload = !app.showUpload)}
    >{t('batch.apply')}</button
  >
</footer>

<style>
  .batchbar {
    display: flex;
    gap: 1.5rem;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border-top: 1px solid var(--border);
    background: var(--bar-bg);
    font-size: 0.85rem;
  }
  .keys {
    opacity: 0.7;
    margin-left: auto;
  }
</style>
