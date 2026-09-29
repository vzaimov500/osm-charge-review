import { expect, test } from 'vitest'
import { DECISION_PROBLEMS } from '../../../src/review'
import { en } from '../../../src/ui/i18n/en'

// A refused decision is shown to the operator as a sentence, never as a code.
test.each(DECISION_PROBLEMS)('%s has a message', (p) => {
  expect(en).toHaveProperty(`problem.${p}`)
})
