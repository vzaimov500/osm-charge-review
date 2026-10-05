import { describe, expect, test } from 'vitest'
import {
  ApiParseError,
  buildChangesetXml,
  buildOsmChange,
  BuildError,
  escapeXml,
  parseApiElements,
  parseDiffResult,
  type ApiNode,
  type ApiWay,
} from '../../../src/osm/build/osmChange'
import {
  changesetTags,
  oblastLabel,
  planBatches,
  planBatchesByArea,
  spanM,
} from '../../../src/osm/build/batch'
import { offset, ORIGIN } from '../match/helpers'

const node: ApiNode = {
  type: 'node',
  id: 11,
  version: 3,
  lat: 42.6977,
  lon: 23.3219,
  tags: { amenity: 'charging_station', opening_hours: '24/7' },
}
const way: ApiWay = {
  type: 'way',
  id: 22,
  version: 5,
  nodes: [1, 2, 3, 1],
  tags: { amenity: 'charging_station', parking: 'surface' },
}

describe('parseApiElements', () => {
  test('nodes, ways, relations, deleted', () => {
    const els = parseApiElements({
      elements: [
        {
          type: 'node',
          id: 1,
          version: 2,
          lat: 1,
          lon: 2,
          tags: { a: 'b' },
          changeset: 9,
          user: 'u',
          uid: 3,
          timestamp: 't',
          visible: true,
        },
        { type: 'way', id: 2, version: 1, nodes: [1, 2] },
        { type: 'relation', id: 3, version: 1, members: [{ type: 'way', ref: 2, role: 'outer' }] },
        { type: 'node', id: 4, version: 5, visible: false },
      ],
    })
    expect(els[0]).toEqual({
      type: 'node',
      id: 1,
      version: 2,
      lat: 1,
      lon: 2,
      tags: { a: 'b' },
      changeset: 9,
      user: 'u',
      uid: 3,
      timestamp: 't',
      visible: true,
    })
    expect(els[1]).toMatchObject({ type: 'way', nodes: [1, 2], tags: {} })
    expect(els[2]).toMatchObject({ type: 'relation', members: [{ ref: 2 }] })
    expect(els[3]).toMatchObject({ type: 'node', visible: false })
  })
  test.each([
    [null, /no elements/],
    [{ elements: [{ type: 'node', id: 1 }] }, /missing id or version/],
    [{ elements: [{ type: 'node', id: 1, version: 1 }] }, /without position/],
    [{ elements: [{ type: 'way', id: 1, version: 1 }] }, /without nodes/],
    [{ elements: [{ type: 'relation', id: 1, version: 1 }] }, /without members/],
    [{ elements: [{ type: 'area', id: 1, version: 1 }] }, /unknown type/],
  ])('rejects %j', (d, msg) => {
    expect(() => parseApiElements(d)).toThrow(ApiParseError)
    expect(() => parseApiElements(d)).toThrow(msg)
  })
})

describe('buildOsmChange', () => {
  test('creates use negative ids; modifies keep every existing tag and the version', () => {
    const xml = buildOsmChange(
      77,
      [
        {
          kind: 'create',
          sourceId: 'a',
          placeholderId: -1,
          lat: 42.1,
          lon: 23.1,
          tags: { amenity: 'charging_station', 'ref:x': '1' },
        },
        { kind: 'modify', sourceId: 'b', current: node, changes: { fee: 'yes' } },
      ],
      'osm-charge-review 1.0',
    )
    expect(xml).toContain('<osmChange version="0.6" generator="osm-charge-review 1.0">')
    expect(xml).toContain(
      '<node id="-1" version="0" changeset="77" lat="42.1000000" lon="23.1000000">',
    )
    expect(xml).toContain('<tag k="ref:x" v="1"/>')
    expect(xml).toContain(
      '<node id="11" version="3" changeset="77" lat="42.6977000" lon="23.3219000">',
    )
    expect(xml).toContain('<tag k="opening_hours" v="24/7"/>') // kept
    expect(xml).toContain('<tag k="fee" v="yes"/>') // added
    expect(xml).not.toContain('<delete')
  })

  test('modifying a way keeps its node list', () => {
    const xml = buildOsmChange(
      1,
      [{ kind: 'modify', sourceId: 'w', current: way, changes: { fee: 'yes' } }],
      'g',
    )
    expect(xml).toMatch(
      /<way id="22" version="5" changeset="1">\s+<nd ref="1"\/>\s+<nd ref="2"\/>\s+<nd ref="3"\/>\s+<nd ref="1"\/>/,
    )
    expect(xml).toContain('<tag k="parking" v="surface"/>')
  })

  test('relations keep members', () => {
    const rel = {
      type: 'relation' as const,
      id: 5,
      version: 2,
      tags: {},
      members: [{ type: 'way' as const, ref: 9, role: 'o"uter' }],
    }
    expect(
      buildOsmChange(
        1,
        [{ kind: 'modify', sourceId: 'r', current: rel, changes: { a: 'b' } }],
        'g',
      ),
    ).toContain('<member type="way" ref="9" role="o&quot;uter"/>')
  })

  test('moving an untagged node keeps it untagged', () => {
    const bare: ApiNode = { type: 'node', id: 5, version: 1, lat: 1, lon: 1, tags: {} }
    expect(
      buildOsmChange(
        1,
        [{ kind: 'modify', sourceId: 'n', current: bare, changes: {}, moveTo: { lat: 2, lon: 2 } }],
        'g',
      ),
    ).toContain('<node id="5" version="1" changeset="1" lat="2.0000000" lon="2.0000000"></node>')
  })

  test('an explicit move changes the node position', () => {
    const xml = buildOsmChange(
      1,
      [
        {
          kind: 'modify',
          sourceId: 'n',
          current: node,
          changes: {},
          moveTo: { lat: 42.7, lon: 23.3 },
        },
      ],
      'g',
    )
    expect(xml).toContain('lat="42.7000000" lon="23.3000000"')
  })

  test('deletes carry the current version (revert only)', () => {
    const xml = buildOsmChange(1, [{ kind: 'delete', sourceId: 'd', current: node }], 'g')
    expect(xml).toContain(
      '<delete if-unused="false">\n    <node id="11" version="3" changeset="1" lat="42.6977000" lon="23.3219000"/>',
    )
    expect(buildOsmChange(1, [{ kind: 'delete', sourceId: 'w', current: way }], 'g')).toContain(
      '<way id="22" version="5" changeset="1"/>',
    )
  })

  test('a dry-run file has no changeset attributes (opens in JOSM)', () => {
    const xml = buildOsmChange(
      null,
      [
        { kind: 'create', sourceId: 'a', placeholderId: -1, lat: 1, lon: 2, tags: {} },
        { kind: 'modify', sourceId: 'b', current: node, changes: { fee: 'yes' } },
      ],
      'g',
    )
    expect(xml).not.toContain('changeset=')
    expect(xml).toContain('<node id="11" version="3" lat=')
  })

  test('special characters are escaped', () => {
    expect(escapeXml(`a&b<c>"d"'e'\n\t\r`)).toBe(
      'a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;&#10;&#9;&#13;',
    )
    const xml = buildOsmChange(
      1,
      [
        {
          kind: 'create',
          sourceId: 'x',
          placeholderId: -1,
          lat: 0,
          lon: 0,
          tags: { note: 'A & B <1>' },
        },
      ],
      'g',
    )
    expect(xml).toContain('v="A &amp; B &lt;1&gt;"')
  })

  test('empty tag sets produce a self-contained element', () => {
    expect(
      buildOsmChange(
        1,
        [{ kind: 'create', sourceId: 'x', placeholderId: -1, lat: 0, lon: 0, tags: {} }],
        'g',
      ),
    ).toContain('lon="0.0000000"></node>')
  })

  test.each([
    [
      'a no-op modify',
      [
        {
          kind: 'modify' as const,
          sourceId: 'n',
          current: node,
          changes: { opening_hours: '24/7' },
        },
      ],
      /change nothing/,
    ],
    [
      'a move to the same place',
      [
        {
          kind: 'modify' as const,
          sourceId: 'n',
          current: node,
          changes: {},
          moveTo: { lat: 42.6977, lon: 23.3219 },
        },
      ],
      /change nothing/,
    ],
    [
      'a positive placeholder',
      [{ kind: 'create' as const, sourceId: 'c', placeholderId: 3, lat: 0, lon: 0, tags: {} }],
      /negative/,
    ],
    [
      'a duplicate placeholder',
      [
        { kind: 'create' as const, sourceId: 'c', placeholderId: -1, lat: 0, lon: 0, tags: {} },
        { kind: 'create' as const, sourceId: 'd', placeholderId: -1, lat: 0, lon: 0, tags: {} },
      ],
      /duplicate placeholder/,
    ],
    [
      'the same object twice',
      [
        { kind: 'modify' as const, sourceId: 'a', current: node, changes: { fee: 'yes' } },
        { kind: 'modify' as const, sourceId: 'b', current: node, changes: { fee: 'no' } },
      ],
      /appears twice/,
    ],
    [
      'a deleted object',
      [
        {
          kind: 'modify' as const,
          sourceId: 'n',
          current: { ...node, visible: false },
          changes: { fee: 'yes' },
        },
      ],
      /deleted upstream/,
    ],
    [
      'moving a way',
      [
        {
          kind: 'modify' as const,
          sourceId: 'w',
          current: way,
          changes: { fee: 'yes' },
          moveTo: { lat: 1, lon: 1 },
        },
      ],
      /only nodes/,
    ],
  ])('refuses %s', (_, items, msg) => {
    expect(() => buildOsmChange(1, items, 'g')).toThrow(BuildError)
    expect(() => buildOsmChange(1, items, 'g')).toThrow(msg)
  })
})

test('buildChangesetXml', () => {
  expect(buildChangesetXml({ comment: 'x & y', created_by: 'osm-charge-review 1' }, 'g')).toBe(
    '<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="g">\n  <changeset>\n    <tag k="comment" v="x &amp; y"/>\n    <tag k="created_by" v="osm-charge-review 1"/>\n  </changeset>\n</osm>\n',
  )
})

describe('parseDiffResult', () => {
  test('creates, modifies and deletes', () => {
    const xml = `<?xml version="1.0"?>\n<diffResult version="0.6" generator="OpenStreetMap server">\n <node old_id="-1" new_id="1001" new_version="1"/>\n <way old_id="22" new_id="22" new_version="6"/>\n <node old_id="11"/>\n</diffResult>`
    expect(parseDiffResult(xml)).toEqual([
      { type: 'node', oldId: -1, newId: 1001, newVersion: 1 },
      { type: 'way', oldId: 22, newId: 22, newVersion: 6 },
      { type: 'node', oldId: 11 },
    ])
  })
  test('rejects other documents', () => {
    expect(() => parseDiffResult('<osm/>')).toThrow(/not a diffResult/)
    expect(() => parseDiffResult('<diffResult><node new_id="1"/></diffResult>')).toThrow(
      /without old_id/,
    )
  })
})

describe('planBatches (geography, not review order)', () => {
  const at = (id: string, km: number, bearing = 90) => ({
    sourceId: id,
    ...offset(ORIGIN.lon, ORIGIN.lat, km * 1000, bearing),
  })

  test('two cities become two changesets', () => {
    const sofia = [at('s1', 0), at('s2', 1), at('s3', 2)]
    const varna = [at('v1', 380), at('v2', 381)]
    const groups = planBatches([varna[0]!, sofia[1]!, varna[1]!, sofia[0]!, sofia[2]!])
    expect(groups.map((g) => g.map((x) => x.sourceId).sort())).toEqual([
      ['s1', 's2', 's3'],
      ['v1', 'v2'],
    ])
  })

  test('the size cap holds', () => {
    const many = Array.from({ length: 23 }, (_, i) => at(`n${i}`, i * 0.1))
    const groups = planBatches(many, { maxItems: 10 })
    expect(groups.map((g) => g.length)).toEqual([10, 10, 3])
  })

  test('every group respects the span limit and every item is used once', () => {
    const pts = Array.from({ length: 40 }, (_, i) => at(`p${i}`, (i * 7) % 60, (i * 53) % 360))
    const groups = planBatches(pts, { maxSpanKm: 20 })
    for (const g of groups) expect(spanM(g)).toBeLessThanOrEqual(20_000)
    expect(
      groups
        .flat()
        .map((x) => x.sourceId)
        .sort(),
    ).toEqual(pts.map((x) => x.sourceId).sort())
  })

  test('ties in position are ordered deterministically', () => {
    const p = at('p', 0)
    const q = { ...p, sourceId: 'q' }
    const north = { ...p, sourceId: 'n', lat: p.lat + 0.001 }
    expect(
      planBatches([north, q, p])
        .flat()
        .map((x) => x.sourceId),
    ).toEqual(['p', 'q', 'n'])
  })

  test('empty input, and spanM of nothing', () => {
    expect(planBatches([])).toEqual([])
    expect(spanM([])).toBe(0)
  })
})

describe('changesetTags', () => {
  const base = {
    datasetName: 'Fines Charging locations, Bulgaria',
    source: 'Fines Charging public API',
    createdBy: 'osm-charge-review 0.1.0',
    creates: 2,
    modifies: 3,
    live: false,
  }
  test('sandbox', () => {
    expect(changesetTags({ ...base, area: 'Sofia' })).toEqual({
      comment: 'Reviewed Fines Charging locations, Bulgaria in Sofia: 2 added, 3 updated',
      created_by: 'osm-charge-review 0.1.0',
      source: 'Fines Charging public API',
    })
  })
  test('live carries the wiki page, forum thread and import=yes', () => {
    expect(
      changesetTags({
        ...base,
        live: true,
        wikiUrl: 'https://wiki/x',
        forumUrl: 'https://forum/y',
        creates: 0,
      }),
    ).toEqual({
      comment: 'Reviewed Fines Charging locations, Bulgaria: 3 updated',
      created_by: 'osm-charge-review 0.1.0',
      source: 'Fines Charging public API',
      'source:url': 'https://wiki/x',
      'discussion:url': 'https://forum/y',
      import: 'yes',
    })
  })
  test('empty batch and length limits', () => {
    expect(changesetTags({ ...base, creates: 0, modifies: 0 }).comment).toMatch(/no changes$/)
    const long = changesetTags({ ...base, datasetName: 'x'.repeat(300), source: 's'.repeat(300) })
    expect(long.comment!.length).toBe(255)
    expect(long.source!.length).toBe(255)
  })
})

describe('planBatchesByArea (one batch per oblast)', () => {
  const at = (id: string, km: number, bearing = 90) => ({
    sourceId: id,
    ...offset(ORIGIN.lon, ORIGIN.lat, km * 1000, bearing),
  })
  const ids = (g: { items: { sourceId: string }[] }) => g.items.map((x) => x.sourceId).sort()

  test('each area is one batch however wide; unknown ones are grouped by distance', () => {
    const area: Record<string, string> = { a1: 'Бургас', a2: 'Бургас', b1: 'Варна' }
    const items = [
      at('a1', 0),
      at('a2', 90),
      at('b1', 300),
      at('u1', 500),
      at('u2', 520),
      at('u3', 700),
    ]
    const groups = planBatchesByArea(items, (it) => area[it.sourceId])
    expect(groups.map((g) => [g.area, ids(g)])).toEqual([
      ['Бургас', ['a1', 'a2']], // 90 km apart, still one oblast
      ['Варна', ['b1']],
      [undefined, ['u1', 'u2']], // within 50 km
      [undefined, ['u3']],
    ])
  })

  test('a large area is split into equal parts, never 50 + a remainder', () => {
    const items = Array.from({ length: 57 }, (_, i) => at(`s${i}`, i * 0.5))
    const sizes = planBatchesByArea(items, () => 'Бургас').map((g) => g.items.length)
    expect(sizes).toEqual([29, 28])
    expect(
      planBatchesByArea(items, () => 'X', { maxItems: 20 }).map((g) => g.items.length),
    ).toEqual([19, 19, 19])
  })

  test('the fallback width can be set; nothing in, nothing out', () => {
    const items = [at('u1', 0), at('u2', 20)]
    expect(planBatchesByArea(items, () => undefined, { fallbackSpanKm: 10 })).toHaveLength(2)
    expect(planBatchesByArea([], () => 'X')).toEqual([])
  })

  test.each([
    ['Бургас', 'област Бургас'],
    ['София-град', 'област София-град'],
    ['Софийска', 'Софийска област'],
    ['Burgas', 'Burgas'],
  ])('%s is named %s in the comment', (name, label) => expect(oblastLabel(name)).toBe(label))
})
