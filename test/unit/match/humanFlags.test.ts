import { describe, expect, test } from 'vitest'
import {
  DEFAULT_MATCH_CONFIG,
  globToRegExp,
  humanFlags,
  type MatchConfig,
} from '../../../src/match'
import { obj } from './helpers'

const now = Date.parse('2026-09-29T00:00:00Z')
const cfg: MatchConfig = {
  ...DEFAULT_MATCH_CONFIG,
  doNotTouch: { objects: ['node/42'], users: ['OptedOut'] },
}

describe('recent human edits', () => {
  test('flags a non-import edit within 12 months', () => {
    expect(
      humanFlags(
        obj(0, {}, { lastEditUser: 'surveyor', lastEditAt: '2026-03-01T00:00:00Z' }),
        cfg,
        now,
      ),
    ).toEqual([{ kind: 'recent_human_edit', user: 'surveyor', at: '2026-03-01T00:00:00Z' }])
  })
  test('ignores edits older than 12 months', () => {
    expect(
      humanFlags(
        obj(0, {}, { lastEditUser: 'surveyor', lastEditAt: '2025-08-01T00:00:00Z' }),
        cfg,
        now,
      ),
    ).toEqual([])
  })
  test.each(['someone_Import', 'SOMEONE_IMPORT', 'bot_imports'])(
    'ignores import account %s',
    (u) => {
      expect(
        humanFlags(obj(0, {}, { lastEditUser: u, lastEditAt: '2026-09-01T00:00:00Z' }), cfg, now),
      ).toEqual([])
    },
  )
  test('ignores missing meta', () => {
    expect(humanFlags(obj(0, {}, { lastEditUser: '', lastEditAt: '' }), cfg, now)).toEqual([])
    expect(humanFlags(obj(0, {}, { lastEditUser: 'x', lastEditAt: 'garbage' }), cfg, now)).toEqual(
      [],
    )
  })
})

describe('survey dates', () => {
  test.each([
    ['check_date', '2026-01-15', true],
    ['survey:date', '2023-01-15', false],
    ['check_date:opening_hours', '2026-05', true],
    ['check_date', 'unknown', false],
  ])('%s=%s → recent %s', (key, value, recent) => {
    expect(humanFlags(obj(0, { amenity: 'charging_station', [key]: value }), cfg, now)).toEqual([
      { kind: 'survey_date', key, value, recent },
    ])
  })
})

describe('do-not-touch list', () => {
  test('by object id', () => {
    expect(humanFlags(obj(0, {}, { osmType: 'node', osmId: 42 }), cfg, now)).toEqual([
      { kind: 'do_not_touch', by: 'object', value: 'node/42' },
    ])
  })
  test('by username, case-insensitive', () => {
    expect(humanFlags(obj(0, {}, { lastEditUser: 'optedout' }), cfg, now)).toContainEqual({
      kind: 'do_not_touch',
      by: 'user',
      value: 'optedout',
    })
  })
})

test('globToRegExp: * stays within one key segment, regex characters are literal', () => {
  expect(globToRegExp('socket:*').test('socket:type2')).toBe(true)
  expect(globToRegExp('socket:*').test('socket:type2:output')).toBe(false)
  expect(globToRegExp('a.b').test('axb')).toBe(false)
})
