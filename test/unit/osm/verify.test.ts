import { describe, expect, test } from 'vitest'
import { buildOsmChange, type ApiElement } from '../../../src/osm/build/osmChange'
import { planRevert, verifyItem, type UploadedItem } from '../../../src/osm/build/verify'

const node = (over: Partial<ApiElement> = {}): ApiElement =>
  ({
    type: 'node',
    id: 1,
    version: 2,
    lat: 1,
    lon: 2,
    tags: { a: '1', fee: 'yes' },
    ...over,
  }) as ApiElement
const way = (over: Partial<ApiElement> = {}): ApiElement =>
  ({
    type: 'way',
    id: 7,
    version: 4,
    nodes: [1, 2, 1],
    tags: { a: '1', fee: 'yes' },
    ...over,
  }) as ApiElement
const upd = (over: Partial<UploadedItem> = {}): UploadedItem => ({
  sourceId: 's',
  kind: 'modify',
  lat: 1,
  lon: 2,
  tags: { fee: 'yes' },
  result: { status: 'ok', osmType: 'node', osmId: 1, version: 2 },
  ...over,
})

describe('verifyItem', () => {
  test('a way: no position check; snapshot tags plus ours', () => {
    const item = upd({ result: { status: 'ok', osmType: 'way', osmId: 7, version: 4 } })
    expect(verifyItem(item, way(), { tags: { a: '1' } }).state).toBe('match')
  })

  test('an update without a snapshot compares our keys only', () => {
    expect(verifyItem(upd(), node({ tags: { fee: 'yes' } }), undefined).state).toBe('match')
    expect(verifyItem(upd(), node(), undefined)).toMatchObject({
      state: 'partial',
      differences: ['a: expected (absent), found 1'],
    })
  })

  test('an intended key that is absent', () => {
    expect(
      verifyItem(upd(), node({ tags: { a: '1' } }), { tags: { a: '1' }, lat: 1, lon: 2 }),
    ).toMatchObject({
      state: 'mismatch',
      differences: ['fee: expected yes, found (absent)'],
    })
  })

  test('a key someone removed since the snapshot: partial', () => {
    expect(
      verifyItem(upd(), node({ tags: { fee: 'yes' } }), { tags: { a: '1' }, lat: 1, lon: 2 }),
    ).toMatchObject({
      state: 'partial',
      differences: ['a: expected 1, found (absent)'],
    })
  })

  test('same tags but a newer version: partial, edited since', () => {
    expect(
      verifyItem(upd(), node({ version: 3 }), { tags: { a: '1' }, lat: 1, lon: 2 }),
    ).toMatchObject({
      state: 'partial',
      differences: ['version 3 (uploaded as 2): edited since'],
    })
  })

  test('an explicit move is checked against the candidate position', () => {
    expect(
      verifyItem(upd({ move: true, lat: 5, lon: 6 }), node({ lat: 5, lon: 6 }), {
        tags: { a: '1' },
        lat: 1,
        lon: 2,
      }).state,
    ).toBe('match')
  })

  test('a node without snapshot position data is not position-checked', () => {
    expect(verifyItem(upd(), node({ lat: 9, lon: 9, tags: { fee: 'yes' } }), undefined).state).toBe(
      'match',
    )
  })
})

describe('planRevert', () => {
  const current = new Map<string, ApiElement>([
    ['node/1', node()],
    ['way/7', way()],
  ])
  test('skips items that did not land; restores ways without a position', () => {
    const plan = planRevert(
      [
        upd({ result: { status: 'conflict' } }),
        upd({ sourceId: 'w', result: { status: 'ok', osmType: 'way', osmId: 7, version: 4 } }),
      ],
      current,
      new Map([['way/7', { tags: { a: '1' } }]]),
    )
    expect(plan.items).toEqual([
      { kind: 'restore', sourceId: 'w', current: way(), tags: { a: '1' } },
    ])
    expect(plan.manual).toEqual([])
  })

  test('without a snapshot the object is listed for manual handling', () => {
    expect(planRevert([upd()], current, new Map()).manual).toEqual([
      { sourceId: 's', object: 'node/1', reason: 'no snapshot recorded' },
    ])
  })

  test('a restore of a way keeps its nodes and sets the exact tags', () => {
    const xml = buildOsmChange(
      9,
      [{ kind: 'restore', sourceId: 'w', current: way(), tags: { a: '1' } }],
      'g',
    )
    expect(xml).toContain('<nd ref="2"/>')
    expect(xml).toContain('<tag k="a" v="1"/>')
    expect(xml).not.toContain('fee')
  })
})
