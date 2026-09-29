import { render, screen } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import App from '../../src/App.svelte'

test('shows the tool name and the OSMF non-affiliation disclaimer', async () => {
  render(App)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('osm-charge-review')
  expect(
    screen.getByText(/Not affiliated with or endorsed by the OpenStreetMap Foundation/),
  ).toBeTruthy()
  // Let start-up finish inside the test: it reads `location`, which is gone
  // once the test environment is torn down (an intermittent CI failure).
  expect(await screen.findByRole('radiogroup', { name: 'Environment' })).toBeTruthy()
})

test('IndexedDB is available in the component environment', () => {
  expect(typeof indexedDB.open).toBe('function')
})
