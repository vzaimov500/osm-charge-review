import { expect, test } from 'vitest'
import { CREATED_BY, TOOL_VERSION } from '../../src/version'

test('created_by names the tool and a semver version', () => {
  expect(TOOL_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  expect(CREATED_BY).toBe(`osm-charge-review ${TOOL_VERSION}`)
})
