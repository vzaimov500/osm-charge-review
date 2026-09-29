<script lang="ts">
  import { t } from './i18n'
</script>

<footer class="batchbar">
  <span class="keys">{t('keys.help')}</span>
</footer>

<style>
  .batchbar {
    display: flex;
    align-items: center;
    padding: 0.35rem 0.75rem;
    border-top: 1px solid var(--border);
    background: var(--bar-bg);
    font-size: 0.8rem;
  }
  .keys {
    opacity: 0.7;
    margin-left: auto;
  }
</style>
