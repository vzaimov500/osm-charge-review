import { expect, test } from 'vitest'
import { canonicalJson, hash53 } from '../../../src/format'

test('canonicalJson sorts keys recursively, including inside arrays', () => {
  expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }, 3], e: null })).toBe(
    '{"a":[{"c":2,"d":1},3],"b":1,"e":null}',
  )
})

test('hash53 is deterministic, 14 hex digits, and seed-sensitive', () => {
  expect(hash53('abc')).toBe(hash53('abc'))
  expect(hash53('abc')).toMatch(/^[0-9a-f]{14}$/)
  expect(hash53('abc')).not.toBe(hash53('abd'))
  expect(hash53('abc', 1)).not.toBe(hash53('abc'))
})

test('generated validator never default-imports a CommonJS helper (bundler interop differs from Node)', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync('src/format/generated/validate.js', 'utf8')
  expect(src).not.toMatch(/^import \w+ from 'ajv\/dist\/runtime/m)
  expect(src).not.toContain('require(')
})
