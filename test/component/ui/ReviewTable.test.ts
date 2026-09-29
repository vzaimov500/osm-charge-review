import { render } from '@testing-library/svelte'
import { readFileSync } from 'node:fs'
import { flushSync } from 'svelte'
import { expect, test } from 'vitest'
import { parseCandidateText } from '../../../src/format'
import ReviewTable from '../../../src/ui/ReviewTable.svelte'
import { AppState } from '../../../src/ui/state.svelte'

// Regression: the virtualizer effect once subscribed to the store it updates,
// looping until Svelte aborted (effect_update_depth_exceeded).
test('the table renders and re-renders without an effect loop', () => {
  const r = parseCandidateText(readFileSync('test/fixtures/format/valid.json', 'utf8'))
  if (!r.ok) throw new Error('fixture')
  const app = new AppState()
  app.dataset = { datasetId: 'example-bg', info: r.dataset.info, importedAt: '', fileHash: '' }
  app.candidates = r.dataset.candidates.map((c) => ({
    ...c,
    datasetId: 'example-bg',
    firstSeen: '',
    lastSeen: '',
    disappeared: false,
  }))

  const errors: unknown[] = []
  const onError = (e: ErrorEvent) => errors.push(e.error)
  window.addEventListener('error', onError)
  render(ReviewTable, { app })
  flushSync()
  app.filters = { ...app.filters, text: 'Sofia' }
  flushSync()
  app.filters = { ...app.filters, text: '' }
  flushSync()
  window.removeEventListener('error', onError)

  expect(errors).toEqual([])
  expect(app.visible).toHaveLength(6)
})
