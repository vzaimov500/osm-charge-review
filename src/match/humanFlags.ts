import { osmKey, type OsmObject } from '../osm/types'
import { matcher, type MatchConfig } from './config'

export type HumanFlag =
  | { kind: 'recent_human_edit'; user: string; at: string }
  | { kind: 'survey_date'; key: string; value: string; recent: boolean }
  | { kind: 'do_not_touch'; by: 'object' | 'user'; value: string }

const SURVEY_KEYS = /^(check_date|survey:date|survey_date|check_date:.+)$/

/** Months between two instants (approximate, 30.44-day months). */
const monthsBetween = (a: number, b: number): number => (b - a) / (30.44 * 24 * 3600 * 1000)

/**
 * Signals that someone looked at this object on the ground or asked not to be
 * touched. They make the respectful path the obvious one; they never
 * decide anything by themselves.
 */
export function humanFlags(
  o: OsmObject,
  cfg: Pick<
    MatchConfig,
    'recentEditMonths' | 'recentSurveyMonths' | 'importAccounts' | 'doNotTouch'
  >,
  now: number,
): HumanFlag[] {
  const out: HumanFlag[] = []
  const isImport = matcher(cfg.importAccounts)

  const edited = Date.parse(o.lastEditAt)
  if (
    o.lastEditUser !== '' &&
    !isImport(o.lastEditUser) &&
    Number.isFinite(edited) &&
    monthsBetween(edited, now) <= cfg.recentEditMonths
  ) {
    out.push({ kind: 'recent_human_edit', user: o.lastEditUser, at: o.lastEditAt })
  }

  for (const [key, value] of Object.entries(o.tags)) {
    if (!SURVEY_KEYS.test(key)) continue
    const t = Date.parse(value.length === 7 ? `${value}-01` : value) // allow YYYY-MM
    out.push({
      kind: 'survey_date',
      key,
      value,
      recent: Number.isFinite(t) && monthsBetween(t, now) <= cfg.recentSurveyMonths,
    })
  }

  if (cfg.doNotTouch.objects.includes(osmKey(o)))
    out.push({ kind: 'do_not_touch', by: 'object', value: osmKey(o) })
  const user = o.lastEditUser.toLowerCase()
  if (cfg.doNotTouch.users.some((u) => u.toLowerCase() === user))
    out.push({ kind: 'do_not_touch', by: 'user', value: o.lastEditUser })
  return out
}
