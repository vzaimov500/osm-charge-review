import { describe, expect, test } from 'vitest'
import { DEFAULT_MATCH_CONFIG } from '../../../src/match'
import { buildRow, MAX_ADD_SHIFT_M, validateDecision } from '../../../src/review'
import { offset } from '../match/helpers'
import { cand, decision, NOW, obj, REF, rows } from './helpers'

const LIVE = { amenity: 'charging_station' }
const SAME_OP = { ...LIVE, operator: 'Example Energy' }

describe('buildRow', () => {
  test('suggests linked over a closer probable match, but only suggests', () => {
    const c = cand()
    const [r] = rows([c], [obj(5, SAME_OP), obj(300, { ...LIVE, [REF]: c.ref! })])
    expect(r!.suggested!.pair.pairClass).toBe('linked')
    expect(r!.targets).toHaveLength(2)
    expect(r!.decision).toBeUndefined()
    expect(r!.decided).toBe(false)
    expect(r!.nearestM).toBeCloseTo(5, 3)
  })

  test('no suggestion when only possible matches exist', () => {
    const [r] = rows([cand()], [obj(80, LIVE)])
    expect(r!.suggested).toBeUndefined()
    expect(r!.updateNeeded).toBeUndefined()
    expect(r!.noop).toBe(false)
    expect(r!.targets).toHaveLength(1)
  })

  test('a linked object with identical tags is a no-op', () => {
    const c = cand()
    const [r] = rows([c], [obj(3, { ...c.tags, opening_hours: '24/7' })])
    expect(r!.noop).toBe(true)
    expect(r!.updateNeeded).toBe(false)
  })

  test('objects linked to another record are warned about and never targets', () => {
    const [r] = rows([cand()], [obj(5, { ...SAME_OP, [REF]: 'someone-else' })])
    expect(r!.targets).toEqual([])
    expect(r!.warnings).toContain('other_ref_nearby')
    expect(r!.nearestM).toBeUndefined()
  })

  test('pairs whose object is missing from the snapshot are skipped', () => {
    const c = cand()
    const [withObject] = rows([c], [obj(5, SAME_OP)])
    const r = buildRow(c, withObject!.match, undefined, {
      objectsByKey: new Map(),
      cfg: DEFAULT_MATCH_CONFIG,
      now: NOW,
    })
    expect(r.targets).toEqual([])
    expect(r.suggested).toBeUndefined()
  })

  test('warnings', () => {
    const c = cand({ status: 'planned', notes: 'n' })
    const [r] = rows(
      [c],
      [
        obj(
          4,
          { ...SAME_OP, check_date: '2026-06-01', capacity: '9' },
          { lastEditUser: 'surveyor', lastEditAt: '2026-08-01T00:00:00Z' },
        ),
        obj(40, SAME_OP),
        obj(30, { 'was:amenity': 'charging_station' }),
      ],
      { [c.sourceId]: decision({ superseded: true }) },
    )
    expect(new Set(r!.warnings)).toEqual(
      new Set([
        'recent_human_edit',
        'recent_survey',
        'lifecycle_nearby',
        'multiple_candidates',
        'not_operational',
        'adapter_notes',
        'superseded',
      ]),
    )
    expect(r!.decided).toBe(false)
  })

  test('conflicts, moved and do-not-touch warnings come from the suggested target', () => {
    const c = cand({
      tags: { amenity: 'charging_station', operator: 'Example Energy', capacity: '2' },
    })
    const cfg = { ...DEFAULT_MATCH_CONFIG, doNotTouch: { objects: [], users: ['optout'] } }
    const [r] = rows(
      [c],
      [obj(40, { ...SAME_OP, capacity: '4' }, { lastEditUser: 'optout' })],
      {},
      cfg,
    )
    expect(r!.warnings).toEqual(expect.arrayContaining(['conflicts', 'moved', 'do_not_touch']))
    expect(r!.targets[0]!.doNotTouch).toBe(true)
  })
})

describe('validateDecision', () => {
  const c = cand()
  const o = obj(5, SAME_OP)
  const [r] = rows([c], [o])
  const target = { osmType: o.osmType, osmId: o.osmId }

  test.each([
    [{ action: 'update' as const }, ['update_without_target']],
    [
      { action: 'update' as const, target: { osmType: 'node' as const, osmId: -1 } },
      ['target_not_nearby'],
    ],
    [{ action: 'update' as const, target, tags: {} }, ['update_changes_nothing']],
    [{ action: 'update' as const, target }, ['update_changes_nothing']],
    [
      { action: 'update' as const, target, tags: { operator: 'Example Energy' } },
      ['update_changes_nothing'],
    ],
    [{ action: 'update' as const, target, tags: {}, move: true }, []],
    [{ action: 'update' as const, target, tags: { fee: 'yes' } }, []],
    [{ action: 'reject' as const }, ['reject_without_reason']],
    [{ action: 'reject' as const, reasonCode: 'duplicate' as const }, []],
    [{ action: 'add' as const }, ['add_without_tags']],
    [{ action: 'add' as const, tags: {} }, ['add_without_tags']],
    [{ action: 'add' as const, tags: c.tags }, []],
    [{ action: 'skip' as const }, []],
  ])('%j → %j', (d, problems) => {
    expect(validateDecision(r!, decision(d))).toEqual(problems)
  })

  test('a new station may be placed near the provider position, not far from it', () => {
    const near = offset(c.lon, c.lat, 120)
    const far = offset(c.lon, c.lat, MAX_ADD_SHIFT_M + 50)
    const [free] = rows([c], [])
    expect(
      validateDecision(free!, decision({ action: 'add', tags: c.tags, position: near })),
    ).toEqual([])
    expect(
      validateDecision(free!, decision({ action: 'add', tags: c.tags, position: far })),
    ).toEqual(['position_too_far'])
  })

  test('a linked station cannot be added again', () => {
    const l = cand()
    const [lr] = rows([l], [obj(30, { ...l.tags })])
    expect(lr!.match.class).toBe('linked')
    expect(validateDecision(lr!, decision({ action: 'add', tags: l.tags }))).toEqual([
      'add_when_linked',
    ])
  })

  test('an update targeting a do-not-touch object is refused', () => {
    const cfg = { ...DEFAULT_MATCH_CONFIG, doNotTouch: { objects: [`node/${o.osmId}`], users: [] } }
    const [r2] = rows([c], [o], {}, cfg)
    expect(
      validateDecision(r2!, decision({ action: 'update', target, tags: { fee: 'yes' } })),
    ).toEqual(['target_do_not_touch'])
  })
})
