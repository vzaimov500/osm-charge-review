<script lang="ts">
  import { t } from './i18n'
  let { text, label }: { text: string; label: string } = $props()
  let copied = $state(false)
  async function copy(e: MouseEvent) {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      copied = true
      setTimeout(() => (copied = false), 1200)
    } catch {
      /* clipboard may be blocked; the value is visible next to the button */
    }
  }
</script>

<button type="button" class="copy" title={`${t('row.copy')}: ${text}`} onclick={copy}
  >{copied ? t('row.copied') : label}</button
>

<style>
  .copy {
    font-size: 0.7rem;
    padding: 0 0.3rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    color: inherit;
    cursor: pointer;
  }
</style>
