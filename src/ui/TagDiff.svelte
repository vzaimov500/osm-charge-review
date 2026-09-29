<script lang="ts">
  import type { TagDivergence } from '../match'
  import type { TargetView } from '../review'
  import { t } from './i18n'

  let {
    candidateTags,
    target,
    selected,
    editable,
    ontoggle,
  }: {
    candidateTags: Record<string, string>
    target: TargetView | undefined
    /** Keys currently ticked for writing (Update only). */
    selected: ReadonlySet<string>
    editable: boolean
    ontoggle: (key: string, on: boolean) => void
  } = $props()

  const conflicts = $derived(new Set(target?.divergence.conflicts ?? []))

  function label(tag: TagDivergence): string {
    if (tag.state === 'same')
      return tag.nuance === 'osm_more_specific' ? t('diff.moreSpecific') : t('diff.same')
    if (tag.state === 'only_in_osm') return t('diff.keep')
    if (tag.nuance === 'variant_in_osm') return t('diff.variant', { key: tag.variantKey ?? '' })
    if (conflicts.has(tag.key)) return t('diff.conflict')
    if (tag.nuance === 'osm_unspecific') return t('diff.unspecific')
    return tag.state === 'missing_in_osm' ? t('diff.add') : t('diff.change')
  }

  function kind(tag: TagDivergence): string {
    if (tag.state === 'same') return 'same'
    if (tag.state === 'only_in_osm') return 'keep'
    if (conflicts.has(tag.key)) return 'conflict'
    return tag.state === 'missing_in_osm' ? 'add' : 'change'
  }
</script>

{#if target}
  <table class="diff">
    <tbody>
      {#each target.divergence.tags as tag (tag.key)}
        {@const changeable = tag.state === 'missing_in_osm' || tag.state === 'differs'}
        <tr class={kind(tag)}>
          <td class="tick">
            {#if changeable}
              <input
                type="checkbox"
                aria-label={`write ${tag.key}`}
                checked={selected.has(tag.key)}
                disabled={!editable}
                onchange={(e) => ontoggle(tag.key, e.currentTarget.checked)}
              />
            {/if}
          </td>
          <td class="key">{tag.key}</td>
          <td class="val">
            {#if tag.state === 'differs'}
              <span class="old">{tag.osm}</span> → <span class="new">{tag.candidate}</span>
            {:else if tag.state === 'only_in_osm'}
              {tag.osm}
            {:else}
              {tag.candidate}
              {#if tag.nuance === 'osm_more_specific'}<span class="old">
                  (OSM: {tag.osm})</span
                >{/if}
            {/if}
          </td>
          <td class="state">{label(tag)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else}
  <table class="diff">
    <tbody>
      {#each Object.entries(candidateTags).sort( ([a], [b]) => a.localeCompare(b, 'en') ) as [k, v] (k)}
        <tr class="add"
          ><td class="tick"></td><td class="key">{k}</td><td class="val">{v}</td><td class="state"
          ></td></tr
        >
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .diff {
    border-collapse: collapse;
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    width: 100%;
  }
  td {
    padding: 1px 4px;
    vertical-align: top;
  }
  .tick {
    width: 1.2rem;
  }
  .key {
    white-space: nowrap;
  }
  .val {
    word-break: break-word;
    min-width: 7rem;
  }
  /* Long explanations wrap instead of squeezing the value column. */
  .state {
    max-width: 12rem;
    font-family: system-ui, sans-serif;
    font-size: 0.72rem;
    opacity: 0.8;
  }
  .same {
    opacity: 0.55;
  }
  .keep {
    opacity: 0.55;
    font-style: italic;
  }
  .add {
    background: var(--add-bg);
  }
  .change {
    background: var(--change-bg);
  }
  .conflict {
    background: var(--conflict-bg);
    font-weight: 600;
  }
  .old {
    text-decoration: line-through;
    opacity: 0.7;
  }
</style>
