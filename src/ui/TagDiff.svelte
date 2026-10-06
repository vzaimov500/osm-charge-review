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
    values = {},
    lockedKeys = [],
    onedit,
    fold = false,
  }: {
    candidateTags: Record<string, string>
    target: TargetView | undefined
    /** Keys currently ticked for writing (Update only). */
    selected: ReadonlySet<string>
    editable: boolean
    ontoggle: (key: string, on: boolean) => void
    /** The values an Update would write (they differ from `candidate` where the reviewer edited). */
    values?: Readonly<Record<string, string>>
    /** Keys that cannot be edited by hand (the station's identity). */
    lockedKeys?: readonly string[]
    /** A value typed by the reviewer. */
    onedit?: (key: string, value: string) => void
    /** Hide unchanged and OSM-only tags behind one toggle: show what would change first. */
    fold?: boolean
  } = $props()

  let showAll = $state(false)
  let editing = $state<string | null>(null)
  let draft = $state('')

  /** The reviewer typed this value: it is what gets written. */
  const edited = (tag: TagDivergence) =>
    values[tag.key] !== undefined && values[tag.key] !== tag.candidate
  const canEdit = (tag: TagDivergence) => editable && !!onedit && !lockedKeys.includes(tag.key)
  function startEdit(tag: TagDivergence) {
    editing = tag.key
    draft = values[tag.key] ?? tag.osm ?? tag.candidate ?? ''
  }
  function commit() {
    const key = editing
    editing = null
    if (key !== null) onedit?.(key, draft)
  }
  function onkey(e: KeyboardEvent) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') editing = null
  }
  const quiet = (tag: TagDivergence) =>
    (tag.state === 'same' || tag.state === 'only_in_osm') && !edited(tag)
  const shown = $derived(
    target ? target.divergence.tags.filter((tag) => !fold || showAll || !quiet(tag)) : [],
  )
  const sameCount = $derived(target?.divergence.tags.filter((x) => x.state === 'same').length ?? 0)
  const keptCount = $derived(
    target?.divergence.tags.filter((x) => x.state === 'only_in_osm').length ?? 0,
  )

  const conflicts = $derived(new Set(target?.divergence.conflicts ?? []))

  function label(tag: TagDivergence): string {
    if (edited(tag)) return t('diff.edited')
    if (tag.state === 'same')
      return tag.nuance === 'osm_more_specific' ? t('diff.moreSpecific') : t('diff.same')
    if (tag.state === 'only_in_osm') return t('diff.keep')
    if (tag.nuance === 'variant_in_osm') return t('diff.variant', { key: tag.variantKey ?? '' })
    if (tag.suggested) return t('diff.suggested')
    if (conflicts.has(tag.key)) return t('diff.conflict')
    if (tag.nuance === 'osm_unspecific') return t('diff.unspecific')
    return tag.state === 'missing_in_osm' ? t('diff.add') : t('diff.change')
  }

  function kind(tag: TagDivergence): string {
    if (edited(tag)) return 'change'
    if (tag.state === 'same') return 'same'
    if (tag.state === 'only_in_osm') return 'keep'
    if (conflicts.has(tag.key)) return 'conflict'
    return tag.state === 'missing_in_osm' ? 'add' : 'change'
  }
</script>

{#if target}
  <table class="diff">
    <tbody>
      {#each shown as tag (tag.key)}
        {@const changeable =
          tag.state === 'missing_in_osm' || tag.state === 'differs' || edited(tag)}
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
            {#if editing === tag.key}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="edit"
                aria-label={t('diff.edit', { key: tag.key })}
                bind:value={draft}
                onkeydown={onkey}
                onblur={commit}
                autofocus
              />
            {:else if edited(tag)}
              {#if tag.osm !== undefined}<span class="old">{tag.osm}</span> →{/if}
              <span class="new">{values[tag.key]}</span>
            {:else if tag.state === 'differs'}
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
          <td class="state"
            >{label(tag)}
            {#if canEdit(tag) && editing !== tag.key}<button
                type="button"
                class="pen"
                title={t('diff.edit', { key: tag.key })}
                aria-label={t('diff.edit', { key: tag.key })}
                onclick={() => startEdit(tag)}>✎</button
              >{/if}</td
          >
        </tr>
      {/each}
    </tbody>
  </table>
  {#if fold && sameCount + keptCount > 0}
    <button type="button" class="fold" onclick={() => (showAll = !showAll)}>
      {showAll ? '▾' : '▸'}
      {t('diff.folded', { same: sameCount, kept: keptCount })}
    </button>
  {/if}
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
  .edit {
    width: 100%;
    font: inherit;
  }
  .pen {
    border: 0;
    background: transparent;
    cursor: pointer;
    padding: 0 0.2rem;
    color: var(--accent);
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
  .fold {
    margin-top: 0.3rem;
    border: 0;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    font-size: 0.8rem;
  }
  .old {
    text-decoration: line-through;
    opacity: 0.7;
  }
</style>
