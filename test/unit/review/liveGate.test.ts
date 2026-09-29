import { describe, expect, test } from 'vitest'
import {
  CHECKLIST,
  confirmsLive,
  EMPTY_LIVE_SETTINGS,
  liveGateProblems,
  waitingDaysLeft,
  type LiveSettings,
} from '../../../src/review'

const now = Date.parse('2026-10-20T12:00:00Z')
const ok: LiveSettings = {
  wikiUrl: 'https://wiki.openstreetmap.org/wiki/Import/Fines_Charging',
  forumUrl: 'https://community.openstreetmap.org/t/12345',
  forumPostedOn: '2026-10-01',
  checklist: Object.fromEntries(CHECKLIST.map((c) => [c, true])),
}
const ctx = { licenceStatus: 'compatible' as const, liveClientId: 'abc', now }

describe('liveGateProblems', () => {
  test('everything recorded → live reachable', () => {
    expect(liveGateProblems(ok, ctx)).toEqual([])
  })

  test('nothing recorded → every requirement listed', () => {
    expect(
      liveGateProblems(EMPTY_LIVE_SETTINGS, { licenceStatus: 'unverified', liveClientId: '', now }),
    ).toEqual([
      'licence_not_compatible',
      'wiki_url_missing',
      'forum_url_missing',
      'forum_date_missing',
      'checklist_incomplete',
      'live_client_id_missing',
    ])
  })

  test.each([
    [{ wikiUrl: '   ' }, 'wiki_url_missing'],
    [{ wikiUrl: 'http://wiki.openstreetmap.org/x' }, 'wiki_url_invalid'],
    [{ wikiUrl: 'not a url' }, 'wiki_url_invalid'],
    [{ forumUrl: 'ftp://x' }, 'forum_url_invalid'],
    [{ forumPostedOn: 'soon' }, 'forum_date_missing'],
    [{ forumPostedOn: '2026-10-10' }, 'waiting_period'],
    [{ checklist: { ...ok.checklist, concerns_resolved: false } }, 'checklist_incomplete'],
  ] as [Partial<LiveSettings>, string][])('%j → %s', (over, problem) => {
    expect(liveGateProblems({ ...ok, ...over }, ctx)).toEqual([problem])
  })

  test('the waiting period is 14 full days', () => {
    expect(
      liveGateProblems(
        { ...ok, forumPostedOn: '2026-10-06' },
        { ...ctx, now: Date.parse('2026-10-19T23:59:59Z') },
      ),
    ).toEqual(['waiting_period'])
    expect(
      liveGateProblems(
        { ...ok, forumPostedOn: '2026-10-06' },
        { ...ctx, now: Date.parse('2026-10-20T00:00:00Z') },
      ),
    ).toEqual([])
  })

  test('a permission licence without documentation blocks', () => {
    expect(liveGateProblems(ok, { ...ctx, licenceStatus: 'permission_undocumented' })).toEqual([
      'licence_not_compatible',
    ])
  })
})

test('waitingDaysLeft', () => {
  expect(waitingDaysLeft('2026-10-10', now)).toBe(4)
  expect(waitingDaysLeft('2026-09-01', now)).toBe(0)
  expect(waitingDaysLeft('', now)).toBe(0)
})

test('the typed confirmation must be exactly "live"', () => {
  expect(confirmsLive('live')).toBe(true)
  expect(confirmsLive(' LIVE ')).toBe(true)
  expect(confirmsLive('yes')).toBe(false)
  expect(confirmsLive('')).toBe(false)
})
