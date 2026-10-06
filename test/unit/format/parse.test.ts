import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  formatIssue,
  licenceStatus,
  parseCandidateText,
  validateCandidateCollection,
  type CandidateCollection,
} from '../../../src/format'

const valid = (): CandidateCollection =>
  JSON.parse(readFileSync(new URL('../../fixtures/format/valid.json', import.meta.url), 'utf8'))

function ok(doc: unknown) {
  const r = validateCandidateCollection(doc)
  if (!r.ok) throw new Error(r.issues.map(formatIssue).join('\n'))
  return r
}

describe('input shape', () => {
  test('reports JSON syntax errors', () => {
    const r = parseCandidateText('{"type": ')
    expect(r.ok).toBe(false)
    expect(r.issues[0]!.code).toBe('JSON_SYNTAX')
  })

  test.each([null, [], 'x', 3])('rejects non-object %j', (v) => {
    const r = validateCandidateCollection(v)
    expect(r.issues[0]!.code).toBe('NOT_AN_OBJECT')
  })

  test('an unknown format version produces exactly one issue, not a schema flood', () => {
    const d = valid() as unknown as { metadata: Record<string, unknown>; features: unknown }
    d.metadata.format_version = '2'
    d.features = 'garbage'
    const r = validateCandidateCollection(d)
    expect(r.issues.map((i) => i.code)).toEqual(['FORMAT_VERSION_UNKNOWN'])
  })

  test('schema errors carry the feature index and source_id', () => {
    const d = valid()
    ;(d.features[3]!.properties as unknown as Record<string, unknown>).colour = 'red'
    const r = validateCandidateCollection(d)
    const i = r.issues.find((x) => x.code === 'SCHEMA')!
    expect(i.featureIndex).toBe(3)
    expect(i.sourceId).toBe('4')
    expect(i.message).toContain('unknown field "colour"')
  })

  test('swapped latitude message explains the likely cause', () => {
    const d = valid()
    d.features[0]!.geometry.coordinates = [41.654363, 124.685366]
    const r = validateCandidateCollection(d)
    expect(r.issues.find((i) => i.code === 'COORD_LAT_OUT_OF_RANGE')!.message).toMatch(/swapped/)
  })
})

describe('tags', () => {
  test('default_tags merge under feature tags; feature wins', () => {
    const d = valid()
    d.features[0]!.properties.tags.operator = 'Someone Else'
    const r = ok(d)
    expect(r.dataset.candidates[0]!.tags.operator).toBe('Someone Else')
    expect(r.dataset.candidates[1]!.tags.operator).toBe('Example Energy')
    expect(r.dataset.candidates[1]!.tags.amenity).toBe('charging_station')
  })

  test('ref is written under metadata.ref_key', () => {
    const r = ok(valid())
    expect(r.dataset.info.ref_key).toBe('ref:example')
    expect(r.dataset.candidates[1]!.tags['ref:example']).toBe('2')
    expect(r.dataset.candidates[1]!.tags.ref).toBeUndefined()
  })

  test('ref_key defaults to "ref"', () => {
    const d = valid()
    delete d.metadata.ref_key
    expect(ok(d).dataset.candidates[1]!.tags.ref).toBe('2')
  })

  test('an identical tag under ref_key is accepted', () => {
    const d = valid()
    d.features[1]!.properties.tags['ref:example'] = '2'
    expect(ok(d).issues).toEqual([])
  })

  test('source:* keys are also forbidden', () => {
    const d = valid()
    d.features[0]!.properties.tags['source:date'] = '2026'
    expect(validateCandidateCollection(d).issues.map((i) => i.code)).toContain(
      'TAG_SOURCE_FORBIDDEN',
    )
  })

  test('source in default_tags is rejected', () => {
    const d = valid()
    d.metadata.default_tags!.source = 'feed'
    const r = validateCandidateCollection(d)
    expect(r.ok).toBe(false)
    expect(r.issues[0]!.path).toBe('/metadata/default_tags/source')
  })

  test('name in default_tags needs one confirmation, not one per feature', () => {
    const d = valid()
    d.metadata.default_tags!.name = 'Example'
    const r = ok(d)
    expect(r.issues.filter((i) => i.code === 'TAG_NAME_PRESENT')).toHaveLength(1)
  })

  test('amenity=charging_station may come from default_tags only', () => {
    const d = valid()
    delete d.features[0]!.properties.tags.amenity
    expect(ok(d).dataset.candidates[0]!.tags.amenity).toBe('charging_station')
  })
})

describe('duplicates', () => {
  const withNeighbour = (dLon: number, tags?: Record<string, string>) => {
    const d = valid()
    const f = structuredClone(d.features[1]!)
    f.properties.source_id = 'n'
    f.properties.ref = '2' // identical effective tags unless overridden
    f.geometry.coordinates = [f.geometry.coordinates[0] + dLon, f.geometry.coordinates[1]]
    if (tags) f.properties.tags = { ...f.properties.tags, ...tags }
    d.features.push(f)
    return d
  }

  test('within the threshold with identical tags is rejected', () => {
    // 0.00004° lon ≈ 3.3 m at 42.7°N
    expect(validateCandidateCollection(withNeighbour(0.00004)).issues.map((i) => i.code)).toContain(
      'DUPLICATE_RECORD',
    )
  })

  test('beyond the threshold is fine', () => {
    // 0.0001° lon ≈ 8.2 m
    expect(validateCandidateCollection(withNeighbour(0.0001)).ok).toBe(true)
  })

  test('different tags at the same spot are a multi-bay site, not a duplicate', () => {
    expect(validateCandidateCollection(withNeighbour(0, { capacity: '4' })).ok).toBe(true)
  })

  test('threshold is configurable', () => {
    expect(validateCandidateCollection(withNeighbour(0.0001), { duplicateDistanceM: 10 }).ok).toBe(
      false,
    )
  })
})

describe('swap heuristic', () => {
  test('needs at least five points', () => {
    const d = valid()
    d.features = d.features.slice(0, 4)
    d.features[1]!.geometry.coordinates = [42.697708, 23.321868]
    expect(ok(d).issues.map((i) => i.code)).not.toContain('COORD_LOOKS_SWAPPED')
  })

  test('a far outlier that does not become plausible when swapped is not flagged', () => {
    const d = valid()
    d.features[1]!.geometry.coordinates = [-70.0, -30.0]
    expect(ok(d).issues.map((i) => i.code)).not.toContain('COORD_LOOKS_SWAPPED')
  })
})

describe('content hash', () => {
  const hashes = (d: CandidateCollection) => ok(d).dataset.candidates.map((c) => c.contentHash)

  test('is stable and ignores key order and display fields', () => {
    const a = hashes(valid())
    const d = valid()
    d.features[0]!.properties.label = 'Renamed'
    d.features[0]!.properties.notes = 'n'
    const t = d.features[0]!.properties.tags
    d.features[0]!.properties.tags = Object.fromEntries(Object.entries(t).reverse())
    expect(hashes(d)).toEqual(a)
  })

  test.each([
    [
      'position',
      (d: CandidateCollection) => (d.features[0]!.geometry.coordinates = [24.6854, 41.6544]),
    ],
    ['a tag', (d: CandidateCollection) => (d.features[0]!.properties.tags.capacity = '2')],
    ['status', (d: CandidateCollection) => (d.features[0]!.properties.status = 'closed')],
    ['a default tag', (d: CandidateCollection) => (d.metadata.default_tags!.operator = 'X')],
  ])('changes when %s changes', (_, mutate) => {
    const a = hashes(valid())[0]
    const d = valid()
    mutate(d)
    expect(hashes(d)[0]).not.toBe(a)
  })
})

describe('licence', () => {
  test.each([
    ['ODbL-1.0', undefined, 'compatible'],
    ['CC0-1.0', undefined, 'compatible'],
    ['LicenseRef-permission', 'https://wiki.example/p', 'compatible'],
    ['LicenseRef-permission', undefined, 'permission_undocumented'],
    ['CC-BY-4.0', undefined, 'unverified'],
    ['LicenseRef-pending', undefined, 'unverified'],
  ] as const)('%s + %s → %s', (licence, url, expected) => {
    expect(licenceStatus(licence, url)).toBe(expected)
  })
})

describe('minimal and edge-case documents', () => {
  test('a feature with only the required fields and no default_tags loads', () => {
    const d = valid()
    delete d.metadata.default_tags
    delete d.metadata.permission_url
    d.features = [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [23.3, 42.7] },
        properties: { source_id: 'a', tags: { amenity: 'charging_station' } },
      },
    ]
    const r = ok(d)
    const c = r.dataset.candidates[0]!
    expect(c).toEqual({
      featureIndex: 0,
      sourceId: 'a',
      lon: 23.3,
      lat: 42.7,
      tags: { amenity: 'charging_station' },
      contentHash: c.contentHash,
    })
    expect(r.dataset.info.default_tags).toEqual({})
  })

  test('missing metadata is a metadata issue', () => {
    const d = valid() as unknown as Record<string, unknown>
    delete d.metadata
    const r = validateCandidateCollection(d)
    expect(r.issues.map((i) => i.code)).toContain('METADATA_FIELD')
    expect(r.issues.find((i) => i.code === 'METADATA_FIELD')!.message).toMatch(
      /document: missing required field "metadata"/,
    )
  })

  test('a missing top-level field is described against the document', () => {
    const d = valid() as unknown as Record<string, unknown>
    delete d.type
    expect(validateCandidateCollection(d).issues[0]!.message).toBe(
      'document: missing required field "type"',
    )
  })

  test('an invalid status lists the allowed values', () => {
    const d = valid()
    ;(d.features[0]!.properties as unknown as Record<string, unknown>).status = 'open'
    expect(validateCandidateCollection(d).issues[0]!.message).toMatch(
      /must be one of "operational", "planned", "closed"/,
    )
  })

  test('a latitude below -90 is also out of range', () => {
    const d = valid()
    d.features[0]!.geometry.coordinates = [24.6, -124.6]
    expect(validateCandidateCollection(d).issues[0]!.code).toBe('COORD_LAT_OUT_OF_RANGE')
  })

  test('tags that are not an object are a schema error on that feature', () => {
    const d = valid()
    ;(d.features[0]!.properties as unknown as Record<string, unknown>).tags =
      'amenity=charging_station'
    const i = validateCandidateCollection(d).issues[0]!
    expect(i.code).toBe('SCHEMA')
    expect(i.featureIndex).toBe(0)
  })

  test('a feature without source_id is reported without one', () => {
    const d = valid()
    delete (d.features[2]!.properties as unknown as Record<string, unknown>).source_id
    const i = validateCandidateCollection(d).issues[0]!
    expect(i.featureIndex).toBe(2)
    expect(i.sourceId).toBeUndefined()
  })

  test('a non-array features member reports a schema error', () => {
    const d = valid() as unknown as Record<string, unknown>
    d.features = {}
    expect(validateCandidateCollection(d).ok).toBe(false)
  })

  test('source_raw with nested arrays hashes deterministically', () => {
    const d = valid()
    d.features[0]!.properties.source_raw = { a: [{ y: 1, x: 2 }] }
    expect(ok(d).dataset.candidates[0]!.sourceRaw).toEqual({ a: [{ y: 1, x: 2 }] })
  })

  test('an outlier with |lon| > 90 cannot be a swap', () => {
    const d = valid()
    d.features[1]!.geometry.coordinates = [120.0, 30.0]
    expect(ok(d).issues.map((i) => i.code)).not.toContain('COORD_LOOKS_SWAPPED')
  })
})

describe('formatIssue', () => {
  test('renders collection-level and feature-level issues', () => {
    expect(formatIssue({ severity: 'error', code: 'NO_FEATURES', message: 'm' })).toBe(
      '[error] NO_FEATURES — m',
    )
    expect(
      formatIssue({ severity: 'warning', code: 'SCHEMA', message: 'm', featureIndex: 2 }),
    ).toBe('[warning] SCHEMA — feature #2: m')
    expect(
      formatIssue({
        severity: 'confirm',
        code: 'SCHEMA',
        message: 'm',
        featureIndex: 2,
        sourceId: 'x',
      }),
    ).toBe('[confirm] SCHEMA — feature #2 (source_id "x"): m')
  })
})

describe('suggested_tags', () => {
  test('kept apart from the tags, without keys the tags already set; not part of the change hash', () => {
    const doc = valid()
    const p0 = doc.features[0]!.properties
    const plain = ok(doc).dataset.candidates[0]!
    p0.suggested_tags = { description: '2x 50kW DC CCS2', amenity: 'parking' }
    const c = ok(doc).dataset.candidates[0]!
    expect(c.suggestedTags).toEqual({ description: '2x 50kW DC CCS2' })
    expect(c.tags.description).toBeUndefined()
    expect(c.contentHash).toBe(plain.contentHash)
    p0.suggested_tags = { amenity: 'parking' }
    expect(ok(doc).dataset.candidates[0]!.suggestedTags).toBeUndefined()
  })
})
