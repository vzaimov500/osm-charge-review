/**
 * Human-readable audit summaries: per batch, pasteable into a wiki
 * progress section or a forum reply. Pure formatting over stored records.
 */
import type { BatchRecord, EventRecord } from '../store/db'

export interface ReportOptions {
  /** Website base for changeset/object links (e.g. https://www.openstreetmap.org). */
  webUrl: string
}

const md = (s: string) => s.replace(/([|\\`*_])/g, '\\$1')

export function batchReportMarkdown(
  b: BatchRecord,
  events: readonly EventRecord[],
  o: ReportOptions,
): string {
  const ok = b.items.filter((i) => i.result?.status === 'ok')
  const creates = ok.filter((i) => i.kind === 'create').length
  const verify = events.filter(
    (e) => e.type === 'verify_result' && b.sourceIds.includes(e.sourceId ?? ''),
  )
  const latestVerify = new Map<string, { state: string }>()
  for (const e of verify) latestVerify.set(e.sourceId!, e.data as { state: string })
  const states = [...latestVerify.values()].reduce<Record<string, number>>(
    (acc, v) => ((acc[v.state] = (acc[v.state] ?? 0) + 1), acc),
    {},
  )
  const revert = events.find(
    (e) =>
      e.type === 'batch_reverted' &&
      (e.data as { changesetId?: number }).changesetId !== undefined &&
      b.status === 'reverted',
  )

  const lines = [
    `### Batch ${md(b.createdAt.slice(0, 16).replace('T', ' '))} UTC — ${b.apiTarget}`,
    '',
    `- Changeset: ${b.changesetId ? `[${b.changesetId}](${o.webUrl}/changeset/${b.changesetId})` : '—'}`,
    `- Comment: ${md(b.comment)}`,
    `- Status: **${b.status}**${b.error ? ` — ${md(b.error)}` : ''}`,
    `- Uploaded: ${ok.length} (${creates} added, ${ok.length - creates} updated); excluded: ${b.items.length - ok.length}`,
    `- Verification: ${
      Object.keys(states).length
        ? Object.entries(states)
            .map(([k, v]) => `${v} ${k}`)
            .join(', ')
        : 'not run'
    }`,
  ]
  if (revert)
    lines.push(
      `- Reverted in changeset [${(revert.data as { changesetId: number }).changesetId}](${o.webUrl}/changeset/${(revert.data as { changesetId: number }).changesetId})`,
    )
  lines.push('', '| source_id | action | result | OSM object |', '| --- | --- | --- | --- |')
  for (const i of b.items) {
    const r = i.result
    const obj =
      r?.osmType && r.osmId ? `[${r.osmType}/${r.osmId}](${o.webUrl}/${r.osmType}/${r.osmId})` : '—'
    lines.push(
      `| ${md(i.sourceId)} | ${i.kind === 'create' ? 'add' : 'update'} | ${r ? `${r.status}${r.message ? ` (${md(r.message)})` : ''}` : 'not sent'} | ${obj} |`,
    )
  }
  return lines.join('\n')
}

export function auditReportMarkdown(
  title: string,
  batches: readonly BatchRecord[],
  events: readonly EventRecord[],
  o: ReportOptions,
): string {
  const sorted = [...batches].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return [
    `## ${md(title)} — upload log`,
    '',
    ...sorted.map((b) => batchReportMarkdown(b, events, o) + '\n'),
  ].join('\n')
}
