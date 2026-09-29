import type { ErrorObject } from 'ajv'
import { distanceM, GridIndex } from '../geo/distance'
import { canonicalJson, hash53 } from './canonical'
import { validate } from './generated/validate.js'
import type { CandidateCollection, DatasetMetadata, OsmTags } from './generated/types'
import type { Issue } from './issues'
import { licenceStatus, type LicenceStatus } from './licence'

export const KNOWN_FORMAT_VERSIONS = ['1'] as const
export const DEFAULT_REF_KEY = 'ref'
/** The feature type this tool reviews. */
export const REQUIRED_TAG = { key: 'amenity', value: 'charging_station' } as const

export interface ParseOptions {
  /** Features closer than this with identical tags are provider duplicates. Default 5 m. */
  duplicateDistanceM?: number
  /** A point further than this from the dataset median, whose swap is not, looks swapped. Default 500 km. */
  swappedOutlierM?: number
}

export interface DatasetInfo extends Omit<DatasetMetadata, 'ref_key' | 'default_tags'> {
  ref_key: string
  default_tags: OsmTags
  licence_status: LicenceStatus
}

export interface Candidate {
  featureIndex: number
  sourceId: string
  lon: number
  lat: number
  ref?: string
  /** Effective tags to write: default_tags ⊕ feature tags ⊕ { [ref_key]: ref }. */
  tags: OsmTags
  label?: string
  address?: string
  status?: 'operational' | 'planned' | 'closed'
  updatedAt?: string
  positionAccuracyM?: number
  notes?: string
  sourceRaw?: Record<string, unknown>
  /**
   * Hash of everything that affects what would be written (position, effective
   * tags, status). A change supersedes earlier decisions. Display-only fields
   * (label, address, notes) are deliberately excluded.
   */
  contentHash: string
}

export interface ParsedDataset {
  info: DatasetInfo
  candidates: Candidate[]
}

export type ParseResult =
  { ok: true; dataset: ParsedDataset; issues: Issue[] } | { ok: false; issues: Issue[] }

/** Parse and validate the text of an interchange file. */
export function parseCandidateText(text: string, options?: ParseOptions): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return fail({
      severity: 'error',
      code: 'JSON_SYNTAX',
      message: `Not valid JSON: ${(e as SyntaxError).message}`,
    })
  }
  return validateCandidateCollection(data, options)
}

/** Validate an already-parsed document. */
export function validateCandidateCollection(
  data: unknown,
  options: ParseOptions = {},
): ParseResult {
  const duplicateDistanceM = options.duplicateDistanceM ?? 5
  const swappedOutlierM = options.swappedOutlierM ?? 500_000

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return fail({
      severity: 'error',
      code: 'NOT_AN_OBJECT',
      message: 'Expected a GeoJSON FeatureCollection object.',
    })
  }

  // Check the version first: a file from a future format would otherwise
  // produce a flood of misleading schema errors.
  const version = (data as { metadata?: { format_version?: unknown } }).metadata?.format_version
  if (version !== undefined && !(KNOWN_FORMAT_VERSIONS as readonly unknown[]).includes(version)) {
    return fail({
      severity: 'error',
      code: 'FORMAT_VERSION_UNKNOWN',
      path: '/metadata/format_version',
      message: `format_version ${JSON.stringify(version)} is not supported; this tool understands ${KNOWN_FORMAT_VERSIONS.map((v) => `"${v}"`).join(', ')}.`,
    })
  }

  // Only called for errors under /features/<n>, so features is an array there.
  const sourceIdAt = (i: number): string | undefined => {
    const features = (data as { features: { properties?: { source_id?: unknown } }[] }).features
    const id = features[i]?.properties?.source_id
    return typeof id === 'string' ? id : undefined
  }

  const issues: Issue[] = []
  if (!validate(data)) {
    for (const err of validate.errors!) issues.push(schemaIssue(err, sourceIdAt))
    return { ok: false, issues: dedupe(issues) }
  }
  const doc: CandidateCollection = data

  // ---- Collection level ----------------------------------------------------
  const meta = doc.metadata
  const refKey = meta.ref_key ?? DEFAULT_REF_KEY
  const defaultTags = meta.default_tags ?? {}
  const licence = licenceStatus(meta.licence, meta.permission_url)
  if (licence === 'permission_undocumented') {
    issues.push({
      severity: 'error',
      code: 'LICENCE_PERMISSION_URL_MISSING',
      path: '/metadata/permission_url',
      message:
        'licence is LicenseRef-permission but permission_url is missing: say where the permission is documented.',
    })
  } else if (licence === 'unverified') {
    issues.push({
      severity: 'warning',
      code: 'LICENCE_NOT_KNOWN_COMPATIBLE',
      path: '/metadata/licence',
      message: `Licence "${meta.licence}" is not known to be compatible with OpenStreetMap. Review is possible; live upload will be refused until compatibility or explicit permission is documented.`,
    })
  }
  issues.push(...tagIssues(defaultTags, '/metadata/default_tags'))

  if (doc.features.length === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_FEATURES',
      path: '/features',
      message: 'The file contains no features.',
    })
  }

  // ---- Feature level -------------------------------------------------------
  const firstIndexOf = new Map<string, number>()
  const candidates: Candidate[] = []

  doc.features.forEach((f, i) => {
    const p = f.properties
    const at = (path: string, issue: Omit<Issue, 'featureIndex' | 'sourceId' | 'path'>): void => {
      issues.push({
        ...issue,
        featureIndex: i,
        sourceId: p.source_id,
        path: `/features/${i}${path}`,
      })
    }

    const prev = firstIndexOf.get(p.source_id)
    if (prev === undefined) firstIndexOf.set(p.source_id, i)
    else
      at('/properties/source_id', {
        severity: 'error',
        code: 'SOURCE_ID_DUPLICATE',
        message: `source_id "${p.source_id}" is also used by feature #${prev}; source_id must be unique.`,
      })

    const [lon, lat] = f.geometry.coordinates
    if (Math.abs(lon) < 1 && Math.abs(lat) < 1) {
      at('/geometry/coordinates', {
        severity: 'warning',
        code: 'COORD_NULL_ISLAND',
        message: `Position ${fmtCoord(lat)}, ${fmtCoord(lon)} is next to 0°, 0° in the Gulf of Guinea — usually a missing or zero coordinate.`,
      })
    }

    for (const issue of tagIssues(p.tags, `/features/${i}/properties/tags`)) {
      issues.push({ ...issue, featureIndex: i, sourceId: p.source_id })
    }
    const tags: OsmTags = { ...defaultTags, ...p.tags }
    if (p.ref !== undefined) {
      const existing = tags[refKey]
      if (existing !== undefined && existing !== p.ref) {
        at('/properties/tags', {
          severity: 'error',
          code: 'TAG_REF_CONFLICT',
          message: `tags.${refKey}="${existing}" disagrees with ref "${p.ref}"; set only ref and let the tool write ${refKey}.`,
        })
      }
      tags[refKey] = p.ref
    }
    if (tags[REQUIRED_TAG.key] !== REQUIRED_TAG.value) {
      at('/properties/tags', {
        severity: 'error',
        code: 'NOT_CHARGING_STATION',
        message: `Effective tags must include ${REQUIRED_TAG.key}=${REQUIRED_TAG.value} (from the feature or default_tags); this tool reviews charging stations only.`,
      })
    }

    const c: Candidate = {
      featureIndex: i,
      sourceId: p.source_id,
      lon,
      lat,
      tags,
      contentHash: hash53(canonicalJson({ lon, lat, tags, status: p.status ?? null })),
    }
    if (p.ref !== undefined) c.ref = p.ref
    if (p.label !== undefined) c.label = p.label
    if (p.address !== undefined) c.address = p.address
    if (p.status !== undefined) c.status = p.status
    if (p.updated_at !== undefined) c.updatedAt = p.updated_at
    if (p.position_accuracy_m !== undefined) c.positionAccuracyM = p.position_accuracy_m
    if (p.notes !== undefined) c.notes = p.notes
    if (p.source_raw !== undefined) c.sourceRaw = p.source_raw
    candidates.push(c)
  })

  issues.push(...nameIssues(doc, defaultTags))
  issues.push(...swappedIssues(candidates, swappedOutlierM))
  issues.push(...duplicateIssues(candidates, duplicateDistanceM))

  if (issues.some((x) => x.severity === 'error')) return { ok: false, issues }

  const { ref_key: _r, default_tags: _d, ...rest } = meta
  return {
    ok: true,
    issues,
    dataset: {
      info: { ...rest, ref_key: refKey, default_tags: defaultTags, licence_status: licence },
      candidates,
    },
  }
}

// ---------------------------------------------------------------------------

function fail(issue: Issue): ParseResult {
  return { ok: false, issues: [issue] }
}

const fmtCoord = (n: number): string => n.toFixed(6)

/** Rules on a tag map beyond what the schema expresses. */
function tagIssues(tags: OsmTags, path: string): Issue[] {
  const out: Issue[] = []
  for (const [k, v] of Object.entries(tags)) {
    if (k !== k.trim() || v !== v.trim()) {
      out.push({
        severity: 'warning',
        code: 'TAG_WHITESPACE',
        path: `${path}/${escapePointer(k)}`,
        message: `Tag "${k}=${v}" has leading or trailing whitespace; it will be compared as-is.`,
      })
    }
    if (k === 'source' || k.startsWith('source:')) {
      out.push({
        severity: 'error',
        code: 'TAG_SOURCE_FORBIDDEN',
        path: `${path}/${escapePointer(k)}`,
        message: `Tag "${k}" is not allowed: the source belongs on the changeset, not on the object.`,
      })
    }
  }
  return out
}

/** `name` is allowed but must be confirmed: provider labels are rarely names on the ground. */
function nameIssues(doc: CandidateCollection, defaultTags: OsmTags): Issue[] {
  if (defaultTags.name !== undefined) {
    return [
      {
        severity: 'confirm',
        code: 'TAG_NAME_PRESENT',
        path: '/metadata/default_tags/name',
        message: `default_tags sets name="${defaultTags.name}" on every feature. Confirm this is the name signed on the ground at every site.`,
      },
    ]
  }
  const withName = doc.features.flatMap((f, i) => (f.properties.tags.name === undefined ? [] : [i]))
  if (withName.length === 0) return []
  return withName.map((i) => ({
    severity: 'confirm' as const,
    code: 'TAG_NAME_PRESENT' as const,
    featureIndex: i,
    sourceId: doc.features[i]!.properties.source_id,
    path: `/features/${i}/properties/tags/name`,
    message: `Sets name="${doc.features[i]!.properties.tags.name}". Provider labels are usually not names on the ground; confirm the adapter's name mapping before loading.`,
  }))
}

/**
 * A point far from the rest of the dataset whose lat/lon swap lands among the
 * rest is almost certainly swapped. Needs enough points for a stable median.
 */
function swappedIssues(cands: readonly Candidate[], outlierM: number): Issue[] {
  if (cands.length < 5) return []
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]!
  }
  const centre = { lon: median(cands.map((c) => c.lon)), lat: median(cands.map((c) => c.lat)) }
  const out: Issue[] = []
  for (const c of cands) {
    if (distanceM(c, centre) <= outlierM) continue
    if (Math.abs(c.lon) > 90) continue // the swap would be an invalid latitude
    if (distanceM({ lon: c.lat, lat: c.lon }, centre) > outlierM) continue
    out.push({
      severity: 'warning',
      code: 'COORD_LOOKS_SWAPPED',
      featureIndex: c.featureIndex,
      sourceId: c.sourceId,
      path: `/features/${c.featureIndex}/geometry/coordinates`,
      message: `Position lat ${fmtCoord(c.lat)}, lon ${fmtCoord(c.lon)} is far from the rest of the dataset, but swapping latitude and longitude puts it among them. GeoJSON is [longitude, latitude].`,
    })
  }
  return out
}

/** Features within a few metres of each other with identical tags: the provider duplicated a record. */
function duplicateIssues(cands: readonly Candidate[], radiusM: number): Issue[] {
  const index = new GridIndex(cands, Math.max(radiusM, 1))
  const tagKey = cands.map((c) => canonicalJson(c.tags))
  const out: Issue[] = []
  cands.forEach((c, i) => {
    for (const j of index.within(c, radiusM)) {
      if (j >= i || tagKey[i] !== tagKey[j]) continue
      const other = cands[j]!
      out.push({
        severity: 'error',
        code: 'DUPLICATE_RECORD',
        featureIndex: c.featureIndex,
        sourceId: c.sourceId,
        path: `/features/${c.featureIndex}`,
        message: `Identical tags to feature #${other.featureIndex} (source_id "${other.sourceId}") ${distanceM(c, other).toFixed(1)} m away — the provider has probably duplicated a record. Remove one in the adapter or make the difference explicit.`,
      })
    }
  })
  return out
}

function escapePointer(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1')
}

function unescapePointer(s: string): string {
  return s.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** Turn an Ajv error into an operator-readable issue with a stable code. */
function schemaIssue(err: ErrorObject, sourceIdAt: (i: number) => string | undefined): Issue {
  const path = err.instancePath
  const m = /^\/features\/(\d+)(\/.*)?$/.exec(path)
  const featureIndex = m ? Number(m[1]) : undefined
  const rest = m?.[2] ?? ''
  const base: Pick<Issue, 'featureIndex' | 'sourceId' | 'path' | 'severity'> = {
    severity: 'error',
    path,
  }
  if (featureIndex !== undefined) {
    base.featureIndex = featureIndex
    const sid = sourceIdAt(featureIndex)
    if (sid !== undefined) base.sourceId = sid
  }
  const p = err.params as Record<string, unknown>

  // Coordinates.
  if (
    rest === '/geometry/coordinates/1' &&
    (err.keyword === 'maximum' || err.keyword === 'minimum')
  ) {
    return {
      ...base,
      code: 'COORD_LAT_OUT_OF_RANGE',
      message: `Latitude ${String(err.data)} is beyond ±90° — longitude and latitude are almost certainly swapped. GeoJSON order is [longitude, latitude].`,
    }
  }
  if (
    rest === '/geometry/coordinates/0' &&
    (err.keyword === 'maximum' || err.keyword === 'minimum')
  ) {
    return {
      ...base,
      code: 'COORD_LON_OUT_OF_RANGE',
      message: `Longitude ${String(err.data)} is outside ±180°.`,
    }
  }
  if (rest.startsWith('/geometry')) {
    return {
      ...base,
      code: 'COORD_INVALID',
      message: `Geometry must be a Point with two numeric coordinates [longitude, latitude] (${describe(err)}).`,
    }
  }

  // Tags. Ajv reports a bad key twice: once from the name check (carrying
  // `propertyName`) and once from the `propertyNames` wrapper; dedupe() keeps one.
  const tagsAt = /\/tags(?:\/(.*))?$/.exec(path)
  if (tagsAt) {
    if (err.keyword === 'minProperties') {
      return {
        ...base,
        code: 'TAGS_EMPTY',
        message: 'tags is empty; every feature needs its mapped OpenStreetMap tags.',
      }
    }
    const badKey = err.keyword === 'propertyNames' ? p.propertyName : err.propertyName
    if (typeof badKey === 'string') {
      return badKey.length === 0
        ? { ...base, code: 'TAG_KEY_EMPTY', message: 'A tag has an empty key.' }
        : {
            ...base,
            code: 'TAG_KEY_TOO_LONG',
            message: `Tag key "${badKey.slice(0, 40)}…" is ${badKey.length} characters; OpenStreetMap allows 255.`,
          }
    }
    const key = tagsAt[1] === undefined ? undefined : unescapePointer(tagsAt[1])
    if (key !== undefined) {
      // Tag values only carry type, minLength and maxLength constraints.
      if (err.keyword === 'minLength')
        return { ...base, code: 'TAG_VALUE_EMPTY', message: `Tag "${key}" has an empty value.` }
      if (err.keyword === 'maxLength')
        return {
          ...base,
          code: 'TAG_VALUE_TOO_LONG',
          message: `Tag "${key}" value is longer than 255 characters.`,
        }
      return {
        ...base,
        code: 'TAG_VALUE_NOT_STRING',
        message: `Tag "${key}" value must be a string (got ${typeof err.data}).`,
      }
    }
  }

  if (
    path.startsWith('/metadata') ||
    (path === '' && err.keyword === 'required' && p.missingProperty === 'metadata')
  ) {
    return { ...base, code: 'METADATA_FIELD', message: `metadata: ${describe(err)}` }
  }
  return { ...base, code: 'SCHEMA', message: describe(err) }
}

function describe(err: ErrorObject): string {
  const p = err.params as Record<string, unknown>
  const where = err.instancePath === '' ? 'document' : err.instancePath
  switch (err.keyword) {
    case 'required':
      return `${where}: missing required field "${String(p.missingProperty)}"`
    case 'additionalProperties':
      return `${where}: unknown field "${String(p.additionalProperty)}"`
    case 'const':
      return `${where}: must be ${JSON.stringify(p.allowedValue)}`
    case 'enum':
      return `${where}: must be one of ${(p.allowedValues as unknown[]).map((v) => JSON.stringify(v)).join(', ')}`
    default:
      return `${where}: ${String(err.message)}`
  }
}

/** Ajv can report one problem more than once (see propertyNames above); keep one. */
function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>()
  return issues.filter((i) => {
    const k = `${i.code}|${i.path}|${i.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
