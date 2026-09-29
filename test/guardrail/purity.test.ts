import { ESLint } from 'eslint'
import { beforeAll, describe, expect, test } from 'vitest'

// Proves purity is enforced by lint, not by habit: pure modules
// may not touch the network, the DOM, storage, or impure layers.
const eslint = new ESLint({ cwd: process.cwd() })

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'fatal')
}

// Loading the ESLint config (and its plugins) is slow on the first call.
beforeAll(() => ruleIds('', 'src/format/warmup.ts'), 60_000)

describe.each(['src/format/x.ts', 'src/match/x.ts', 'src/osm/build/x.ts'])('%s', (file) => {
  test.each([
    ['fetch', "export const f = () => fetch('https://example.org')"],
    ['document', 'export const f = () => document.title'],
    ['indexedDB', "export const f = () => indexedDB.open('x')"],
    ['localStorage', "export const f = () => localStorage.getItem('x')"],
  ])('rejects %s', async (_, code) => {
    expect(await ruleIds(code, file)).toContain('no-restricted-globals')
  })

  test.each([
    ['idb', "export { openDB } from 'idb'"],
    ['leaflet', "export { map } from 'leaflet'"],
    ['store layer', "export * from '../../store/db'"],
  ])('rejects importing %s', async (_, code) => {
    expect(await ruleIds(code, file)).toContain('no-restricted-imports')
  })

  test('accepts plain data code', async () => {
    expect(await ruleIds('export const add = (a: number, b: number) => a + b', file)).toEqual([])
  })
})

test('impure layers are unaffected', async () => {
  expect(
    await ruleIds("export const f = () => fetch('https://example.org')", 'src/osm/transport/x.ts'),
  ).toEqual([])
})
