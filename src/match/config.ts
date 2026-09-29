export interface MatchConfig {
  /** `probable` radius and inner `possible` radius. */
  probableRadiusM: number
  /** Outer `possible` radius; beyond it a candidate is `none`. */
  possibleRadiusM: number
  /** Geometry difference above which a linked object counts as `moved`. */
  movedThresholdM: number
  /** Edits by non-import accounts within this many months are flagged. */
  recentEditMonths: number
  /** Surveys (`check_date`, `survey:date`) within this many months are flagged as recent. */
  recentSurveyMonths: number
  /** Accounts whose edits are imports, not surveys. Case-insensitive; `*` wildcard. */
  importAccounts: readonly string[]
  /** Opt-outs: object ids (`node/123`) and usernames never to touch. */
  doNotTouch: { objects: readonly string[]; users: readonly string[] }
  /**
   * Keys a human plausibly surveyed: a `differs` on these is a conflict
   * needing a per-key tick. `*` matches within one key segment.
   */
  surveyedKeys: readonly string[]
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  probableRadiusM: 50,
  possibleRadiusM: 150,
  movedThresholdM: 25,
  recentEditMonths: 12,
  recentSurveyMonths: 24,
  importAccounts: ['*_import', '*_imports'],
  doNotTouch: { objects: [], users: [] },
  surveyedKeys: [
    'opening_hours',
    'access',
    'fee',
    'capacity',
    'socket:*',
    'socket:*:*',
    'charging_station:output',
    'operator',
    'brand',
    'name',
    'parking:fee',
    'authentication:*',
    'payment:*',
  ],
}

/** Glob (`*` = any run of characters except `:`) → anchored, case-insensitive RegExp. */
export function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^:]*')
  return new RegExp(`^${esc}$`, 'i')
}

export function matcher(globs: readonly string[]): (s: string) => boolean {
  const res = globs.map(globToRegExp)
  return (s) => res.some((r) => r.test(s))
}
