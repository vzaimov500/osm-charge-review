<script lang="ts">
  import { formatIssue } from '../format'
  import { t } from './i18n'
  import type { AppState } from './state.svelte'

  let { app }: { app: AppState } = $props()
  let dragging = $state(false)
  let input: HTMLInputElement

  const p = $derived(app.pending)
  const errors = $derived(p?.issues.filter((i) => i.severity === 'error') ?? [])
  const confirms = $derived(p?.issues.filter((i) => i.severity === 'confirm') ?? [])
  const warnings = $derived(p?.issues.filter((i) => i.severity === 'warning') ?? [])

  async function take(files: FileList | null | undefined) {
    const f = files?.[0]
    if (f) await app.readFile(f)
  }
</script>

<section
  class="loader"
  class:dragging
  aria-label={t('loader.title')}
  ondragover={(e) => {
    e.preventDefault()
    dragging = true
  }}
  ondragleave={() => (dragging = false)}
  ondrop={(e) => {
    e.preventDefault()
    dragging = false
    void take(e.dataTransfer?.files)
  }}
>
  <h2>{t('loader.title')}</h2>
  <p>{t('loader.hint')}</p>
  <input
    bind:this={input}
    type="file"
    data-testid="candidate-file"
    accept=".json,.geojson,application/geo+json,application/json"
    hidden
    onchange={(e) => void take(e.currentTarget.files)}
  />
  <button type="button" onclick={() => input.click()}>{t('loader.choose')}</button>

  {#if p}
    {#if errors.length}
      <div class="report error" role="alert">
        <strong>{t('loader.rejected')}</strong>
        <ul>
          {#each errors.slice(0, 200) as i, n (n)}<li>
              <code>{i.code}</code>
              {formatIssue(i).replace(/^\[\w+\] \w+ — /, '')}
            </li>{/each}
        </ul>
        {#if errors.length > 200}<p>… {errors.length - 200} more</p>{/if}
      </div>
    {/if}
    {#if confirms.length && !errors.length}
      <div class="report confirm">
        <strong>{t('loader.confirmTitle')}</strong>
        <ul>
          {#each confirms.slice(0, 50) as i, n (n)}<li>
              {formatIssue(i).replace(/^\[\w+\] \w+ — /, '')}
            </li>{/each}
        </ul>
        {#if confirms.length > 50}<p>… {confirms.length - 50} more</p>{/if}
        <button type="button" onclick={() => void app.confirmPending()}
          >{t('loader.confirm')}</button
        >
        <button type="button" onclick={() => (app.pending = null)}>{t('loader.cancel')}</button>
      </div>
    {/if}
    {#if warnings.length}
      <div class="report warning">
        <strong>{t('loader.warnings')}</strong>
        <ul>
          {#each warnings.slice(0, 50) as i, n (n)}<li>
              <code>{i.code}</code>
              {formatIssue(i).replace(/^\[\w+\] \w+ — /, '')}
            </li>{/each}
        </ul>
      </div>
    {/if}
  {/if}
</section>

<style>
  .loader {
    margin: 1rem;
    padding: 1rem;
    border: 2px dashed var(--border);
    border-radius: 8px;
  }
  .dragging {
    border-color: var(--accent);
  }
  .report {
    margin-top: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    font-size: 0.85rem;
    max-height: 40vh;
    overflow: auto;
  }
  .error {
    background: var(--conflict-bg);
  }
  .confirm,
  .warning {
    background: var(--change-bg);
  }
</style>
