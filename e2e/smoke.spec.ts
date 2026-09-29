import { expect, test } from '@playwright/test'

test('app loads in a secure context with the disclaimer', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('osm-charge-review')
  await expect(page.getByText(/Not affiliated with or endorsed/)).toBeVisible()
  // PKCE needs crypto.subtle, which only exists in secure contexts.
  expect(await page.evaluate(() => window.isSecureContext && !!crypto.subtle)).toBe(true)
})
