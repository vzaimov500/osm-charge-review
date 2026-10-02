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

    // The detail map shows the nearby OSM objects once the data has arrived.
    await page.locator('.li[data-code^="P"], .li[data-code^="L"]').first().click()
    await expect(page.locator('section.detail .minimap path[stroke="#2563eb"]')).toHaveCount(1)

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
    expect(await page.locator('.li').count()).toBeLessThan(60)
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
      for (let y = 0; y < el.scrollHeight; y += 200) {
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
    await expect(page.locator('.li').last()).toBeVisible()
  })

  test('keyboard decisions survive a reload', async ({ page }) => {
    await offline(page)
    await loadQueue(page)
    await page.getByRole('button', { name: 'Fetch OpenStreetMap data' }).click()
    await expect(page.getByText(/OSM data from/)).toBeVisible()

    const rows = page.locator('.li')
    // Wait for each decision to show before the next key, as a reviewer would.
    await page.locator('body').press('4') // skip row 1; the station stays open
    await expect(rows.nth(0)).toHaveAttribute('data-decision', 'skip')
    await expect(rows.nth(0)).toHaveClass(/sel/)
    await page.locator('body').press('s')
    // Row 2 is linked (an OSM object carries its ref): Add would duplicate it.
    await expect(rows.nth(1)).toHaveAttribute('data-code', /^L/)
    await expect(page.getByRole('radio', { name: /Add/ })).toBeDisabled()
    await page.locator('body').press('2')
    await page.locator('body').press('3') // reject row 2 → reason picker
    await page.getByRole('combobox', { name: 'Reason' }).selectOption('duplicate')
    await expect(rows.nth(1)).toHaveAttribute('data-decision', 'reject')
    await page.locator('body').press('s')
    await page.locator('body').press('2') // add row 3
    await expect(rows.nth(2)).toHaveAttribute('data-decision', 'add')

    await page.reload()
    await expect(page.getByText('600 of 600')).toBeVisible()
    await expect(rows.nth(0)).toHaveAttribute('data-decision', 'skip')
    await expect(rows.nth(1)).toHaveAttribute('data-decision', 'reject')
    await expect(rows.nth(2)).toHaveAttribute('data-decision', 'add')
    await expect(page.getByRole('button', { name: 'Upload · 1 ready' })).toBeVisible()
  })

  test('a changed source record is flagged and excluded until re-confirmed', async ({ page }) => {
    await offline(page)
    await loadQueue(page)
    await page.locator('body').press('2') // add row "1"
    await expect(page.getByRole('button', { name: 'Upload · 1 ready' })).toBeVisible()

    const doc = JSON.parse((await import('node:fs')).readFileSync(QUEUE, 'utf8'))
    doc.features[0].properties.tags.fee = 'no'
    const changed = join(tmpdir(), `queue-changed-${Date.now()}.json`)
    writeFileSync(changed, JSON.stringify(doc))
    await page.getByTestId('candidate-file-header').setInputFiles(changed)
    await expect(page.getByText(/1 changed.*1 decisions need re-confirming/)).toBeVisible()

    await expect(page.getByRole('button', { name: 'Upload · 0 ready' })).toBeVisible()
    const row = page.locator('section.detail')
    await expect(row.getByText(/changed since decision/)).toBeVisible()
    await row.getByRole('button', { name: 'Re-confirm' }).click()
    await expect(page.getByRole('button', { name: 'Upload · 1 ready' })).toBeVisible()
  })

  test('a decision stays on the station; W / S move, Q / E jump to undecided', async ({ page }) => {
    await offline(page)
    await loadQueue(page)
    const rows = page.locator('.li')
    const key = (k: string) => page.locator('body').press(k)
    // No OSM object nearby: Update is not offered, and its key does nothing.
    await expect(page.getByRole('radio', { name: /Update/ })).toBeDisabled()
    await key('1')
    await expect(rows.nth(0)).toHaveAttribute('data-decision', '')
    await key('2')
    await expect(rows.nth(0)).toHaveAttribute('data-decision', 'add')
    await expect(rows.nth(0)).toHaveClass(/sel/) // no jump
    await expect(page.getByTestId('step')).toContainText('Saved: Add')
    await key('s')
    await expect(rows.nth(1)).toHaveClass(/sel/)
    await key('w') // back
    await expect(rows.nth(0)).toHaveClass(/sel/)
    await key('ArrowDown')
    await key('ArrowDown')
    await key('ArrowDown')
    await key('4')
    await expect(rows.nth(3)).toHaveAttribute('data-decision', 'skip')
    await expect(rows.nth(3)).toHaveClass(/sel/)
    await key('q') // previous undecided: index 2 (0 and 3 are decided)
    await expect(rows.nth(2)).toHaveClass(/sel/)
    await key('e') // next undecided: index 4, past the skipped one
    await expect(rows.nth(4)).toHaveClass(/sel/)

    // Keys follow the key's position, not the letter: a Bulgarian layout sends 'в' on W.
    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'в', code: 'KeyW', bubbles: true })),
    )
    await expect(rows.nth(3)).toHaveClass(/sel/)
    await key('s')
    await expect(rows.nth(4)).toHaveClass(/sel/)
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
  const rows = page.locator('.li')
  await page.locator('body').press('4')
  await expect(rows.nth(0)).toHaveAttribute('data-decision', 'skip')
  await page.locator('body').press('s')
  await page.locator('body').press('2')
  await expect(rows.nth(1)).toHaveAttribute('data-decision', 'add')
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
  await expect(rows.nth(0)).toHaveAttribute('data-decision', 'skip')
  await expect(rows.nth(1)).toHaveAttribute('data-decision', 'add')
  await expect(page.getByRole('button', { name: 'Upload · 1 ready' })).toBeVisible()
})

test('the layout follows the window: no sideways scroll, filters become a drawer', async ({
  page,
}) => {
  await offline(page)
  await loadQueue(page)
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  const filters = page.getByRole('complementary', { name: 'Filters' })
  await page.setViewportSize({ width: 1400, height: 800 })
  await expect(filters).toBeVisible()
  for (const width of [1024, 800]) {
    await page.setViewportSize({ width, height: 800 })
    expect(await overflow()).toBeLessThanOrEqual(0)
  }
  await expect(filters).toBeHidden()
  await page.getByRole('button', { name: 'Filters', exact: true }).click()
  await expect(filters).toBeVisible()
  await filters.getByRole('button', { name: /Close filters/ }).click()
  await expect(filters).toBeHidden()
  // The map is told about its new size and keeps the station in the middle.
  await expect(page.locator('.leaflet-container')).toBeVisible()
  await page.setViewportSize({ width: 1400, height: 800 })
  await expect(filters).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const box = document.querySelector('.leaflet-container')!.getBoundingClientRect()
        const dot = [...document.querySelectorAll('.leaflet-interactive')].at(-1)!
        const d = dot.getBoundingClientRect()
        return Math.abs(d.x + d.width / 2 - (box.x + box.width / 2))
      }),
    )
    .toBeLessThan(4)
})
