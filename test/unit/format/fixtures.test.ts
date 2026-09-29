import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { formatIssue, parseCandidateText, type IssueCode } from '../../../src/format'

const dir = new URL('../../fixtures/format/', import.meta.url)
const read = (name: string): string => readFileSync(new URL(name, dir), 'utf8')
const list = (sub: string): string[] =>
  readdirSync(new URL(sub, dir)).filter((f) => f.endsWith('.json'))

test('the valid fixture loads cleanly', () => {
  const r = parseCandidateText(read('valid.json'))
  expect(r.issues).toEqual([])
  expect(r.ok).toBe(true)
  if (!r.ok) return
  expect(r.dataset.candidates).toHaveLength(6)
  expect(r.dataset.info.licence_status).toBe('compatible')
})

// Every validation rule has a failing fixture that produces a clear message.
describe('each rejection rule has a failing fixture', () => {
  test.each(list('invalid/'))('%s', (file) => {
    const code = file.replace(/\.json$/, '') as IssueCode
    const r = parseCandidateText(read(`invalid/${file}`))
    expect(r.ok).toBe(false)
    const hit = r.issues.find((i) => i.code === code)
    expect(hit, r.issues.map(formatIssue).join('\n')).toBeDefined()
    expect(hit!.severity).toBe('error')
    expect(hit!.message.length).toBeGreaterThan(15)
    // Feature-level problems name the feature.
    if (hit!.path?.startsWith('/features/')) expect(hit!.featureIndex).toBeTypeOf('number')
  })
})

describe('each warning/confirm rule has a fixture that still loads', () => {
  test.each(list('warn/'))('%s', (file) => {
    const code = file.replace(/\.json$/, '') as IssueCode
    const r = parseCandidateText(read(`warn/${file}`))
    expect(r.ok, r.issues.map(formatIssue).join('\n')).toBe(true)
    const hit = r.issues.find((i) => i.code === code)
    expect(hit).toBeDefined()
    expect(hit!.severity === 'warning' || hit!.severity === 'confirm').toBe(true)
  })
})

test('every rejection code declared in the issue model has a fixture', () => {
  const src = readFileSync(new URL('../../../src/format/issues.ts', import.meta.url), 'utf8')
  const declared = [...src.matchAll(/\| '([A-Z_]+)'/g)].map((m) => m[1]!)
  const covered = new Set(
    [...list('invalid/'), ...list('warn/')].map((f) => f.replace(/\.json$/, '')),
  )
  // Covered by focused unit tests instead of fixture files:
  for (const c of ['JSON_SYNTAX', 'NOT_AN_OBJECT']) covered.add(c)
  expect(declared.filter((c) => !covered.has(c))).toEqual([])
})
