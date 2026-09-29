import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { FakeOsmApi } from '../test/support/fakeOsmApi'
import { loadQueue, offline } from './helpers'

const SANDBOX = 'https://master.apis.dev.openstreetmap.org'

/** Serve the sandbox API from the in-memory fake. `hold` swallows the upload response (the tab dies waiting). */
async function fakeSandbox(
  context: BrowserContext,
  fake: FakeOsmApi,
  opts: { hold?: 'before-server' | 'after-server' } = {},
) {
  let applied!: () => void
  const uploadApplied = new Promise<void>((r) => (applied = r))
  await context.route(`${SANDBOX}/api/0.6/**`, async (route) => {
    const req = route.request()
    // Capture everything synchronously: the page may be closed at any moment.
    const method = req.method()
    const url = req.url()
    const headers = req.headers()
    const body = req.postData() ?? undefined
    const isUpload = method === 'POST' && url.endsWith('/upload')
    if (isUpload && opts.hold === 'before-server') return // never reaches the server
    const res = await fake.fetch(url, { method, headers, body })
    if (isUpload && opts.hold === 'after-server') {
      applied() // the server applied it; the answer never arrives
      return
    }
    await route
      .fulfill({
        status: res.status,
        body: await res.text(),
        headers: Object.fromEntries(res.headers),
      })
      .catch(() => {})
  })
  return { uploadApplied }
}

/** Pretend the operator signed in: osm-auth keeps the token under the auth URL. */
async function signedIn(context: BrowserContext) {
  await context.addInitScript(
    (url) => localStorage.setItem(`${url}oauth2_access_token`, 'e2e-token'),
    SANDBOX,
  )
}

async function decideAndPlan(page: Page) {
  // Sandbox: reads and writes the sandbox (routed to the fake here).
  await page.getByRole('radio', { name: 'Sandbox (test)' }).check()
  await expect(page.getByText('reads and writes the OSM sandbox')).toBeVisible()
  // Keyboard shortcuts are ignored while a form control has focus.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const rows = page.locator('.li')
  await page.locator('body').press('2')
  await expect(rows.nth(0)).toHaveAttribute('data-decision', 'add')
  await expect(rows.nth(1)).toHaveClass(/sel/) // moved on by itself
  await page.locator('body').press('2')
  await expect(rows.nth(1)).toHaveAttribute('data-decision', 'add')
  await page.getByRole('button', { name: /^Upload · \d+ ready$/ }).click()
  await page.getByRole('button', { name: 'Plan batches from ready decisions' }).click()
  await expect(page.getByText(/batches planned/)).toBeVisible()
}

test('a batch uploads to the sandbox and prompts for an export', async ({ page, context }) => {
  const fake = new FakeOsmApi(SANDBOX)
  await fakeSandbox(context, fake)
  await signedIn(context)
  await offline(page)
  await loadQueue(page)
  await decideAndPlan(page)
  await expect(page.getByText('sandbox_tester', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Upload to sandbox' }).first().click()
  await expect(page.getByText(/Batch uploaded: \d+ changes/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export state' }).first()).toBeVisible()
  expect([...fake.changesets.values()].every((c) => !c.open)).toBe(true)
  expect(
    fake.requests.filter((r) => r.method !== 'GET').every((r) => r.auth === 'Bearer e2e-token'),
  ).toBe(true)
})

for (const hold of ['after-server', 'before-server'] as const) {
  test(`killing the tab mid-upload leaves recoverable state (${hold})`, async ({ context }) => {
    const fake = new FakeOsmApi(SANDBOX)
    const server = await fakeSandbox(context, fake, { hold })
    await signedIn(context)
    const page = await context.newPage()
    await offline(page)
    await loadQueue(page)
    await decideAndPlan(page)
    const uploadSent = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith('/upload'),
    )
    await page.getByRole('button', { name: 'Upload to sandbox' }).first().click()
    await uploadSent
    if (hold === 'after-server') await server.uploadApplied
    await page.close() // the tab dies with the upload in the air

    const again = await context.newPage()
    await offline(again)
    await again.goto('/')
    await again.getByRole('button', { name: /^Upload · \d+ ready$/ }).click()
    await expect(again.getByText(/In flight at step "upload"/)).toBeVisible()
    await again.getByRole('button', { name: 'Recover' }).click()
    if (hold === 'after-server') {
      await expect(again.getByText(/Batch uploaded: \d+ changes/)).toBeVisible()
      await expect(again.getByRole('cell', { name: /^verified/ })).toBeVisible() // recovered, then read back
    } else {
      await expect(again.getByText(/the upload did not reach the server/).first()).toBeVisible()
      await expect(again.getByRole('button', { name: 'Upload · 2 ready' })).toBeVisible() // still ready: nothing landed
    }
    expect(fake.requests.filter((r) => r.path.endsWith('/upload'))).toHaveLength(
      hold === 'after-server' ? 1 : 0,
    )
    expect([...fake.changesets.values()].every((c) => !c.open)).toBe(true)
  })
}

test('read-back verifies; revert restores, refusing an object someone else edited', async ({
  page,
  context,
}) => {
  const fake = new FakeOsmApi(SANDBOX)
  await fakeSandbox(context, fake)
  await signedIn(context)
  await offline(page)
  await loadQueue(page)
  // Two adds close together so they land in one batch.
  await decideAndPlan(page)
  await page.getByRole('button', { name: 'Upload to sandbox' }).first().click()
  await expect(page.getByText(/Batch uploaded/)).toBeVisible()
  await expect(page.getByRole('cell', { name: /^verified/ }).first()).toBeVisible()

  // Another account edits one of the created objects.
  const created = [...fake.elements.values()].filter(
    (e) => e.version === 1 && e.tags['ref:example'],
  )
  expect(created.length).toBeGreaterThan(0)
  fake.editByOther('node', created[0]!.id, { note: 'surveyed' })

  await page.getByRole('button', { name: 'Revert…' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Revert this batch?' })
  await expect(dialog).toBeVisible()
  if (created.length === 1) {
    await expect(dialog).toContainText(/handle manually/)
    await expect(dialog.getByRole('button', { name: 'Revert' })).toBeDisabled()
  } else {
    await expect(dialog).toContainText(`node/${created[0]!.id}`)
    await dialog.getByRole('button', { name: 'Revert' }).click()
    await expect(page.getByText(/Reverted \d+ objects in changeset/)).toBeVisible()
    expect(fake.get('node', created[0]!.id)!.visible).toBe(true) // someone else's edit was not steamrolled
    expect(fake.get('node', created[1]!.id)!.visible).toBe(false)
  }
})
