import { svelte } from '@sveltejs/vite-plugin-svelte'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// OSM only accepts https redirect URIs, even for 127.0.0.1. `pnpm cert` makes a
// self-signed pair in .cert/ (gitignored); HTTPS=1 serves dev/preview with it.
const https =
  process.env.HTTPS === '1'
    ? {
        key: readFileSync(new URL('./.cert/key.pem', import.meta.url)),
        cert: readFileSync(new URL('./.cert/cert.pem', import.meta.url)),
      }
    : undefined

export default defineConfig({
  plugins: [svelte()],
  // Relative base so the build works from any GitHub Pages sub-path.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: 'es2023', sourcemap: true },
  server: { https },
  preview: { https },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,svelte}'],
      exclude: ['src/format/generated/**'],
      reporter: ['text', 'html', 'lcov'],
      // Pure modules protect the map: they must stay exhaustively tested.
      thresholds: {
        'src/format/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/geo/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/osm/build/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/match/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/review/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.test.ts', 'test/guardrail/**/*.test.ts'],
        },
      },
      {
        extends: true,
        resolve: { conditions: ['browser'] },
        test: {
          name: 'component',
          environment: 'happy-dom',
          include: ['test/component/**/*.test.ts'],
          setupFiles: ['test/component/setup.ts'],
        },
      },
    ],
  },
})
