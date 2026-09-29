import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeOsmApi } from '../test/support/fakeOsmApi'
import { loadQueue, offline, QUEUE } from './helpers'

const LIVE_API = 'https://api.openstreetmap.org'
const LIVE_WEB = 'https://www.openstreetmap.org'

/** Tests must never reach the real live API: route it to the fake, abort the website. */
async function neverRealLive(context: BrowserContext, fake: FakeOsmApi) {
  await context.route(`${LIVE_WEB}/**`, (r) => r.abort())
  await context.route(`${LIVE_API}/**`, async (route) => {
    const req = route.request()
    const res = await fake.fetch(req.url(), {
      method: req.method(),
      headers: req.headers(),
      body: req.postData() ?? undefined,
    })
    await route
      .fulfill({
        status: res.status,
        body: await res.text(),
        headers: Object.fromEntries(res.headers),
      })
      .catch(() => {})
  })
}

/** A copy of the e2e queue with an OSM-compatible licence. */
function compatibleQueue(): string {
  const doc = JSON.parse(readFileSync(QUEUE, 'utf8'))
  doc.metadata.licence = 'LicenseRef-permission'
  doc.metadata.permission_url = 'https://wiki.openstreetmap.org/wiki/Import/Example'
  const file = join(tmpdir(), `queue-compatible-${Date.now()}.json`)
  writeFileSync(file, JSON.stringify(doc))
  return file
}

async function openGate(page: Page) {
  await page.getByRole('button', { name: /^Upload · \d+ ready$/ }).click()
  // Live OSM is read freely; writing needs the gate.
  await expect(page.getByRole('radio', { name: 'Live OSM' })).toBeChecked()
  await expect(page.getByText('reads live OSM · writing locked')).toBeVisible()
  await page.getByRole('button', { name: 'Unlock…' }).first().click()
  const gate = page.getByRole('dialog', { name: 'Unlock writing to LIVE OpenStreetMap' })
  await expect(gate).toBeVisible()
  return gate
}

test('live is unreachable with the required URLs unset', async ({ page, context }) => {
  const fake = new FakeOsmApi(LIVE_API)
  await neverRealLive(context, fake)
  await context.addInitScript(
    (url) => localStorage.setItem(`${url}oauth2_access_token`, 'live-token'),
    LIVE_WEB,
  )
  await offline(page)
  await loadQueue(page, compatibleQueue())
  const gate = await openGate(page)

  // Everything except the two URLs.
  await gate.getByLabel('Date the forum review was posted').fill('2026-09-01')
  for (const box of await gate.getByRole('checkbox').all()) await box.check()
  await gate.getByLabel(/Live OAuth2 client id/).fill('live-client')
  await gate.getByLabel(/Live OAuth2 client id/).press('Tab')

  await expect(gate.locator('[data-problem]')).toHaveText([
    /wiki page URL is missing/,
    /forum thread URL is missing/,
  ])
  await expect(gate.getByRole('button', { name: 'Unlock writing to LIVE' })).toBeDisabled()
  await expect(gate.getByLabel('Type "live" to confirm')).toHaveCount(0)
  await gate.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('reads live OSM · writing locked')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload to live' })).toHaveCount(0)
  expect(fake.requests.filter((r) => r.method !== 'GET')).toHaveLength(0)
})

test('an incompatible licence alone keeps live locked', async ({ page, context }) => {
  const fake = new FakeOsmApi(LIVE_API)
  await neverRealLive(context, fake)
  await offline(page)
  await loadQueue(page) // LicenseRef-pending
  const gate = await openGate(page)
  await expect(gate.locator('[data-problem="licence_not_compatible"]')).toBeVisible()
  await expect(gate.getByRole('button', { name: 'Unlock writing to LIVE' })).toBeDisabled()
})

test('with everything recorded: typed confirmation, small first batch, dry run before upload, tagged changeset', async ({
  page,
  context,
}) => {
  const fake = new FakeOsmApi(LIVE_API)
  await neverRealLive(context, fake)
  await context.addInitScript(
    (url) => localStorage.setItem(`${url}oauth2_access_token`, 'live-token'),
    LIVE_WEB,
  )
  await offline(page)
  await loadQueue(page, compatibleQueue())

  const rows = page.locator('article.row')
  for (let i = 0; i < 3; i++) {
    await page.locator('body').press('a')
    await expect(rows.nth(i).getByRole('radio', { name: /Add/ })).toBeChecked()
    await page.locator('body').press('j')
  }

  const gate = await openGate(page)
  await gate
    .getByLabel('Import wiki page URL')
    .fill('https://wiki.openstreetmap.org/wiki/Import/Example')
  await gate
    .getByLabel('Community forum review thread URL')
    .fill('https://community.openstreetmap.org/t/example/1')
  await gate.getByLabel('Date the forum review was posted').fill('2026-09-01')
  for (const box of await gate.getByRole('checkbox').all()) await box.check()
  await gate.getByLabel(/Live OAuth2 client id/).fill('live-client')
  await gate.getByLabel(/Live OAuth2 client id/).press('Tab')
  await expect(gate.locator('[data-problem]')).toHaveCount(0)
  await expect(gate.getByText('Signed in as sandbox_tester')).toBeVisible()
  await expect(gate.getByText(LIVE_API)).toBeVisible()

  const confirm = gate.getByLabel('Type "live" to confirm')
  await confirm.fill('yes')
  await expect(gate.getByRole('button', { name: 'Unlock writing to LIVE' })).toBeDisabled()
  await confirm.fill('live')
  await gate.getByRole('button', { name: 'Unlock writing to LIVE' }).click()
  await expect(page.getByText(/^LIVE · First live batches/)).toBeVisible()
  await expect(page.getByText('reads and writes LIVE OpenStreetMap')).toBeVisible()

  await page.getByRole('button', { name: 'Plan batches from ready decisions' }).click()
  const upload = page.getByRole('button', { name: 'Upload to live' }).first()
  await expect(upload).toBeDisabled() // dry run first
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Dry run (.osc for JOSM)' }).first().click()
  await download
  await expect(upload).toBeEnabled()
  await upload.click()
  await expect(page.getByText(/Batch uploaded/)).toBeVisible()

  const cs = [...fake.changesets.values()][0]!
  expect(cs.tags).toMatchObject({
    'source:url': 'https://wiki.openstreetmap.org/wiki/Import/Example',
    'discussion:url': 'https://community.openstreetmap.org/t/example/1',
    import: 'yes',
  })
  const batchSizes = [...fake.changesets.values()].map((c) => c.written.length)
  for (const n of batchSizes) expect(n).toBeLessThanOrEqual(10)
})
