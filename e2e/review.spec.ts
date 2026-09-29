import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadQueue, offline, QUEUE } from './helpers'

test.describe('review queue', () => {
  test('loads 600 candidates, fetches OSM once, classifies', async ({ page }) => {
    const net = await offline(page)
    await loadQueue(page)
    await expect(page.getByText('600 of 600')).toBeVisible()
    // Licence is not compatible: shown prominently.
    await expect(page.getByText(/live upload blocked/)).toBeVisible()

    await page.getByRole('button', { name: 'Fetch OpenStreetMap data' }).click()
    await expect(page.getByText(/OSM data from .* objects\)/)).toBeVisible()
    expect(net.overpassCalls()).toBe(1)

    // Mini-maps created before the OSM data arrived now show nearby objects too.
    const probable = page
      .locator('article.row')
      .filter({ has: page.locator('.chip.class-probable, .chip.class-linked') })
      .first()
    await expect(probable.locator('.minimap path[stroke="#2563eb"]')).toHaveCount(1)

    // Reload within the cache window: no new request.
    await page.reload()
    await expect(page.getByText(/OSM data from/)).toBeVisible()
    expect(net.overpassCalls()).toBe(1)
  })

  test('scrolls 600 rows smoothly', async ({ page }) => {
    await offline(page)
    await loadQueue(page)
    const scroller = page.locator('.scroller')
    // Only a window of rows is in the DOM.
    expect(await page.locator('article.row').count()).toBeLessThan(20)
    const stats = await scroller.evaluate(async (el) => {
      const frames: number[] = []
      let last = performance.now()
      let running = true
      const tick = (t: number) => {
        frames.push(t - last)
        last = t
        if (running) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      for (let y = 0; y < el.scrollHeight; y += 400) {
        el.scrollTop = y
        await new Promise((r) => requestAnimationFrame(r))
      }
      running = false
      frames.sort((a, b) => a - b)
      return { frames: frames.length, p95: frames[Math.floor(frames.length * 0.95)]! }
    })
    expect(stats.frames).toBeGreaterThan(50)
    // Generous for slow machines; a janky list is far above this.
    expect(stats.p95).toBeLessThan(120)
    await expect(page.locator('article.row').last()).toBeVisible()
  })

  test('keyboard decisions survive a reload', async ({ page }) => {
    await offline(page)
    await loadQueue(page)
    await page.getByRole('button', { name: 'Fetch OpenStreetMap data' }).click()
    await expect(page.getByText(/OSM data from/)).toBeVisible()

    const rows = page.locator('article.row')
    // Wait for each decision to show before the next key, as a reviewer would.
    await page.locator('body').press('s') // skip row 1
    await expect(rows.nth(0).getByRole('radio', { name: /Skip/ })).toBeChecked()
    await page.locator('body').press('j')
    await expect(rows.nth(1)).toHaveClass(/focused/)
    await page.locator('body').press('a') // add row 2
    await expect(rows.nth(1).getByRole('radio', { name: /Add/ })).toBeChecked()
    await page.locator('body').press('j')
    await page.locator('body').press('r') // reject row 3 → reason picker
    await page.getByRole('combobox', { name: 'Reason' }).selectOption('duplicate')
    await expect(rows.nth(2).getByRole('radio', { name: /Reject/ })).toBeChecked()

    await page.reload()
    await expect(page.getByText('600 of 600')).toBeVisible()
    await expect(rows.nth(0).getByRole('radio', { name: /Skip/ })).toBeChecked()
    await expect(rows.nth(1).getByRole('radio', { name: /Add/ })).toBeChecked()
    await expect(rows.nth(2).getByRole('radio', { name: /Reject/ })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Upload · 1 ready' })).toBeVisible()
  })

  test('a changed source record is flagged and excluded until re-confirmed', async ({ page }) => {
    await offline(page)
    await loadQueue(page)
    await page.locator('body').press('a') // add row "1"
    await expect(page.getByRole('button', { name: 'Upload · 1 ready' })).toBeVisible()

    const doc = JSON.parse((await import('node:fs')).readFileSync(QUEUE, 'utf8'))
    doc.features[0].properties.tags.fee = 'no'
    const changed = join(tmpdir(), `queue-changed-${Date.now()}.json`)
    writeFileSync(changed, JSON.stringify(doc))
    await page.getByTestId('candidate-file-header').setInputFiles(changed)
    await expect(page.getByText(/1 changed.*1 decisions need re-confirming/)).toBeVisible()

    await expect(page.getByRole('button', { name: 'Upload · 0 ready' })).toBeVisible()
    const row = page.locator('article.row').first()
    await expect(row.getByText(/changed since decision/)).toBeVisible()
    await row.getByRole('button', { name: 'Re-confirm' }).click()
    await expect(page.getByRole('button', { name: 'Upload · 1 ready' })).toBeVisible()
  })

  test('filters are reflected in the URL and restored', async ({ page }) => {
    await offline(page)
    await loadQueue(page)
    await page.getByPlaceholder(/Search label/).fill('Station 12')
    await expect(page).toHaveURL(/q=Station\+12/)
    await page.reload()
    await expect(page.getByPlaceholder(/Search label/)).toHaveValue('Station 12')
    await expect(page.getByText(/^\d+ of 600$/)).toBeVisible()
  })

  test('a busy Overpass produces a clear message and no retry', async ({ page }) => {
    const net = await offline(page, { overpassStatus: 504 })
    await loadQueue(page)
    await page.getByRole('button', { name: 'Fetch OpenStreetMap data' }).click()
    await expect(page.getByRole('alert')).toContainText(/Overpass is busy/)
    expect(net.overpassCalls()).toBe(1)
  })
})

test('export, clear browser storage, import: every decision is intact', async ({ page }) => {
  await offline(page)
  await loadQueue(page)
  const rows = page.locator('article.row')
  await page.locator('body').press('s')
  await expect(rows.nth(0).getByRole('radio', { name: /Skip/ })).toBeChecked()
  await page.locator('body').press('j')
  await page.locator('body').press('a')
  await expect(rows.nth(1).getByRole('radio', { name: /Add/ })).toBeChecked()
  await expect(page.getByText(/2 decisions since — export now/)).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export state' }).click()
  const file = join(tmpdir(), `state-${Date.now()}.json`)
  await (await download).saveAs(file)
  await expect(page.getByText(/Last exported/)).toBeVisible()
  await expect(page.getByText(/decisions since/)).toHaveCount(0)

  // Clear all browser storage for the site.
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases()
    await Promise.all(
      dbs.map(
        (d) =>
          new Promise((r) => {
            // The app closes its connection on request, so this completes.
            const q = indexedDB.deleteDatabase(d.name!)
            q.onsuccess = q.onerror = r
          }),
      ),
    )
  })
  await page.reload()
  await expect(page.getByText('Load a candidate file')).toBeVisible()
  await expect(page.getByText('Never exported')).toBeVisible()

  await page.getByTestId('state-import').setInputFiles(file)
  await expect(page.getByRole('dialog')).toContainText(/Will write 2 decisions, 600 candidates/)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText(/State imported: 2 decisions written/)).toBeVisible()
  await expect(rows.nth(0).getByRole('radio', { name: /Skip/ })).toBeChecked()
  await expect(rows.nth(1).getByRole('radio', { name: /Add/ })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Upload · 1 ready' })).toBeVisible()
})
