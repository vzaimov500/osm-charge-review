import { defineConfig, devices } from '@playwright/test'

const PORT = 4173

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Slow machines and shared CI runners: assertions wait up to 15 s.
  expect: { timeout: 15_000 },
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  // Serve the production build: that is what users get, and localhost is a
  // secure context, so crypto.subtle (needed for PKCE) is available.
  webServer: {
    // vite directly: the pnpm launcher does not pass the stop signal on, which hangs teardown.
    command: `vite build && vite preview --port ${PORT} --strictPort`,
    port: PORT,
    // Always build and serve fresh: a reused server silently serves a stale build.
    reuseExistingServer: false,
  },
})
