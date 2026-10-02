import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'

export const QUEUE = 'test/fixtures/e2e/queue-600.json'
const OVERPASS = readFileSync('test/fixtures/e2e/overpass-600.json', 'utf8')

/** Never touch real services from tests: tiles are blanked, Overpass is served from a fixture. */
export async function offline(
  page: Page,
  opts: { overpassStatus?: number } = {},
): Promise<{ overpassCalls: () => number }> {
  let calls = 0
  for (const tiles of [
    'https://tile.openstreetmap.org/**',
    'https://bg-imagery.openstreetmap.org/**',
    'https://server.arcgisonline.com/**',
    'https://api.mapbox.com/**',
  ])
    await page.route(tiles, (r) => r.fulfill({ status: 204, body: '' }))
  await page.route(/\/api\/interpreter$/, (r) => {
    calls++
    return opts.overpassStatus
      ? r.fulfill({ status: opts.overpassStatus, body: 'busy' })
      : r.fulfill({ status: 200, contentType: 'application/json', body: OVERPASS })
  })
  return { overpassCalls: () => calls }
}

export async function loadQueue(page: Page, file = QUEUE): Promise<void> {
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))
  page.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()))
  await page.goto('/')
  await page.getByRole('button', { name: 'Choose file…' }).waitFor()
  // The input is hidden behind the button; set the file directly (no native dialog).
  await page.getByTestId('candidate-file').setInputFiles(file)
  await page.getByText(/Loaded 600 candidates/).waitFor()
}
