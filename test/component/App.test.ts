import { render, screen } from '@testing-library/svelte'
import { expect, test } from 'vitest'
import App from '../../src/App.svelte'

test('shows the tool name and the OSMF non-affiliation disclaimer', () => {
  render(App)
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('osm-charge-review')
  expect(
    screen.getByText(/Not affiliated with or endorsed by the OpenStreetMap Foundation/),
  ).toBeTruthy()
})

test('IndexedDB is available in the component environment', () => {
  expect(typeof indexedDB.open).toBe('function')
})
