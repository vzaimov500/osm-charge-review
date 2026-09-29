import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import ts from 'typescript-eslint'
import svelteConfig from './svelte.config.js'

/**
 * Pure modules: no network, no DOM, no storage. They operate on
 * plain data and return plain data, so they can be tested exhaustively in Node.
 */
export const PURE_MODULES = [
  'src/format/**',
  'src/geo/**',
  'src/match/**',
  'src/osm/build/**',
  'src/review/**',
]

const impureGlobals = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'window',
  'document',
  'navigator',
  'location',
  'indexedDB',
  'localStorage',
  'sessionStorage',
].map((name) => ({
  name,
  message: 'Pure module: no network, DOM or storage access. Pass data in instead.',
}))

export default ts.config(
  {
    ignores: [
      'dist',
      'coverage',
      'playwright-report',
      'test-results',
      'test/guardrail/fixtures',
      'src/format/generated/validate.js',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig,
      },
    },
  },
  {
    files: PURE_MODULES,
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': ['error', ...impureGlobals],
      'no-restricted-imports': [
        'error',
        {
          paths: ['idb', 'leaflet', 'osm-auth', 'svelte', 'svelte/store'].map((name) => ({
            name,
            message: 'Pure module: this dependency performs I/O or touches the DOM.',
          })),
          patterns: [
            {
              group: ['**/store/**', '**/ui/**', '**/audit/**', '**/osm/transport/**'],
              message: 'Pure module: may not depend on impure layers.',
            },
          ],
        },
      ],
    },
  },
)
