import { describe, expect, test } from 'vitest'
import { MATCH_CLASSES } from '../../../src/match'
import { ACTIONS, batchStateOf, MATCH_CHAR, statusCode, type RowModel } from '../../../src/review'
import { cand, decision, rows } from './helpers'

const base = rows([cand()], [])[0]!
const row = (over: Partial<RowModel> = {}): RowModel => ({ ...base, ...over })
const code = (r: RowModel, b?: Parameters<typeof statusCode>[1]) => {
  const s = statusCode(r, b)
  return s.match + s.decision + s.batch + s.attention
}

describe('statusCode (read like ls -l: match, decision, batch, attention)', () => {
  test('an untouched new candidate', () => {
    expect(code(row({ warnings: [] }))).toBe('N---')
  })

  test.each(MATCH_CLASSES)('match class %s has its own letter', (c) => {
    expect(statusCode(row({ match: { ...base.match, class: c } })).match).toBe(MATCH_CHAR[c])
  })

  test('every match letter is distinct', () => {
    expect(new Set(Object.values(MATCH_CHAR)).size).toBe(MATCH_CLASSES.length)
  })

  test.each(ACTIONS)('decision %s', (a) => {
    expect(statusCode(row({ decision: decision({ action: a }) })).decision).toBe(
      a[0]!.toUpperCase(),
    )
  })

  test.each([
    ['planned', 'b'],
    ['uploaded', 'u'],
    ['verified', 'v'],
  ] as const)('batch %s → %s', (b, ch) => {
    expect(statusCode(row(), b).batch).toBe(ch)
  })

  test('recent edits and surveys are information, not a call to act', () => {
    expect(statusCode(row({ warnings: ['recent_human_edit', 'recent_survey'] })).attention).toBe(
      '-',
    )
    expect(statusCode(row({ warnings: ['recent_human_edit', 'adapter_notes'] })).attention).toBe(
      '!',
    )
  })

  test('attention: changed by the provider outranks other warnings', () => {
    expect(statusCode(row({ warnings: ['conflicts'] })).attention).toBe('!')
    expect(statusCode(row({ warnings: ['conflicts', 'superseded'] })).attention).toBe('*')
  })
})

describe('batchStateOf', () => {
  test.each([
    ['draft', 'planned'],
    ['in_flight', 'uploaded'],
    ['verified', 'verified'],
    ['failed', undefined],
    ['reverted', undefined],
  ])('%s → %s', (s, want) => expect(batchStateOf(s)).toBe(want))
})
