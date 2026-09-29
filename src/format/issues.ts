/**
 * Validation findings. `code` is stable and is what the UI and tests key on;
 * `message` is prose for the operator.
 *
 * - `error`   — the file is rejected.
 * - `confirm` — the file loads only after the operator explicitly confirms.
 * - `warning` — shown, does not block.
 */
export type Severity = 'error' | 'confirm' | 'warning'

export type IssueCode =
  | 'JSON_SYNTAX'
  | 'NOT_AN_OBJECT'
  | 'FORMAT_VERSION_UNKNOWN'
  | 'SCHEMA'
  | 'METADATA_FIELD'
  | 'LICENCE_PERMISSION_URL_MISSING'
  | 'LICENCE_NOT_KNOWN_COMPATIBLE'
  | 'NO_FEATURES'
  | 'SOURCE_ID_DUPLICATE'
  | 'COORD_LAT_OUT_OF_RANGE'
  | 'COORD_LON_OUT_OF_RANGE'
  | 'COORD_INVALID'
  | 'COORD_NULL_ISLAND'
  | 'COORD_LOOKS_SWAPPED'
  | 'TAGS_EMPTY'
  | 'TAG_KEY_EMPTY'
  | 'TAG_VALUE_EMPTY'
  | 'TAG_KEY_TOO_LONG'
  | 'TAG_VALUE_TOO_LONG'
  | 'TAG_VALUE_NOT_STRING'
  | 'TAG_WHITESPACE'
  | 'TAG_SOURCE_FORBIDDEN'
  | 'TAG_NAME_PRESENT'
  | 'TAG_REF_CONFLICT'
  | 'NOT_CHARGING_STATION'
  | 'DUPLICATE_RECORD'

export interface Issue {
  severity: Severity
  code: IssueCode
  message: string
  /** Index into `features`, when the issue concerns one feature. */
  featureIndex?: number
  sourceId?: string
  /** JSON Pointer into the input document. */
  path?: string
}

/** One-line rendering for logs and plain-text reports. */
export function formatIssue(i: Issue): string {
  const where =
    i.featureIndex === undefined
      ? ''
      : `feature #${i.featureIndex}${i.sourceId === undefined ? '' : ` (source_id "${i.sourceId}")`}: `
  return `[${i.severity}] ${i.code} — ${where}${i.message}`
}
