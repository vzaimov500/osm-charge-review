/**
 * Live gating. Pure: given what the operator has recorded,
 * list everything that still blocks live uploads. Live is reachable only when
 * this list is empty.
 */
import type { LicenceStatus } from '../format'

export const WAITING_DAYS = 14

export const CHECKLIST = [
  'permission_documented',
  'wiki_published',
  'forum_posted',
  'concerns_resolved',
  'import_account',
] as const
export type ChecklistItem = (typeof CHECKLIST)[number]

export interface LiveSettings {
  wikiUrl: string
  forumUrl: string
  /** ISO date (YYYY-MM-DD) of the community review post. */
  forumPostedOn: string
  checklist: Partial<Record<ChecklistItem, boolean>>
}

export const EMPTY_LIVE_SETTINGS: LiveSettings = {
  wikiUrl: '',
  forumUrl: '',
  forumPostedOn: '',
  checklist: {},
}

export type GateProblem =
  | 'licence_not_compatible'
  | 'wiki_url_missing'
  | 'wiki_url_invalid'
  | 'forum_url_missing'
  | 'forum_url_invalid'
  | 'forum_date_missing'
  | 'waiting_period'
  | 'checklist_incomplete'
  | 'live_client_id_missing'

const httpsUrl = (s: string): boolean => {
  try {
    return new URL(s).protocol === 'https:'
  } catch {
    return false
  }
}

export function liveGateProblems(
  s: LiveSettings,
  ctx: { licenceStatus: LicenceStatus; liveClientId: string; now: number },
): GateProblem[] {
  const out: GateProblem[] = []
  if (ctx.licenceStatus !== 'compatible') out.push('licence_not_compatible')
  if (!s.wikiUrl.trim()) out.push('wiki_url_missing')
  else if (!httpsUrl(s.wikiUrl.trim())) out.push('wiki_url_invalid')
  if (!s.forumUrl.trim()) out.push('forum_url_missing')
  else if (!httpsUrl(s.forumUrl.trim())) out.push('forum_url_invalid')
  const posted = Date.parse(`${s.forumPostedOn}T00:00:00Z`)
  if (!s.forumPostedOn || Number.isNaN(posted)) out.push('forum_date_missing')
  else if (ctx.now - posted < WAITING_DAYS * 86_400_000) out.push('waiting_period')
  if (CHECKLIST.some((c) => s.checklist[c] !== true)) out.push('checklist_incomplete')
  if (!ctx.liveClientId.trim()) out.push('live_client_id_missing')
  return out
}

/** Days until the waiting period ends (0 when elapsed or unknown). */
export function waitingDaysLeft(forumPostedOn: string, now: number): number {
  const posted = Date.parse(`${forumPostedOn}T00:00:00Z`)
  if (Number.isNaN(posted)) return 0
  return Math.max(0, Math.ceil((posted + WAITING_DAYS * 86_400_000 - now) / 86_400_000))
}

/** A typed confirmation, deliberately annoying. */
export const LIVE_CONFIRM_WORD = 'live'
export const confirmsLive = (typed: string): boolean =>
  typed.trim().toLowerCase() === LIVE_CONFIRM_WORD

/** First live batches are small and local. */
export const FIRST_LIVE_BATCH = { maxItems: 10, maxSpanKm: 5 } as const
