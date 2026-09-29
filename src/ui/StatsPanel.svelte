<script lang="ts">
  import { MATCH_CLASSES } from '../match'
  import { ACTIONS } from '../review'
  import { t } from './i18n'
  import type { AppState } from './state.svelte'
  let { app }: { app: AppState } = $props()
  const s = $derived(app.stats)
</script>

<section class="stats" aria-label={t('stats.title')}>
  <table>
    <caption>{t('stats.title')} — {s.total}</caption>
    <tbody>
      <tr
        ><th>class</th>{#each MATCH_CLASSES as c (c)}<td>{c}<br /><b>{s.byClass[c]}</b></td
          >{/each}</tr
      >
      <tr
        ><th>decision</th>{#each [...ACTIONS, 'undecided'] as const as a (a)}<td
            >{a}<br /><b>{s.byAction[a]}</b></td
          >{/each}</tr
      >
      <tr
        ><th>matched</th><td>update needed<br /><b>{s.matched.updateNeeded}</b></td><td
          >no-op<br /><b>{s.matched.noop}</b></td
        ><td>superseded<br /><b>{s.superseded}</b></td><td
          >with warnings<br /><b>{s.withWarnings}</b></td
        ></tr
      >
    </tbody>
  </table>
</section>

<style>
  .stats {
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.8rem;
  }
  caption {
    text-align: left;
    font-weight: 600;
  }
  th {
    text-align: left;
    padding-right: 0.8rem;
  }
  td {
    padding: 0 0.6rem;
    text-align: center;
  }
</style>
