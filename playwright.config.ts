import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration for ZK Secret Santa Web UI
 *
 * Tests are divided into:
 * - Basic tests (e2e.spec.ts): Don't require Aztec sandbox
 * - Secret Santa tests (secret-santa.spec.ts): Require running sandbox
 *
 * Global setup deploys contracts to sandbox if not already deployed.
 *
 * Run with: yarn test:e2e
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // Run tests in parallel when possible, but some game flow tests need sequential execution
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: process.env.PLAYWRIGHT_NUM_WORKERS
    ? Number(process.env.PLAYWRIGHT_NUM_WORKERS)
    : 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    // Capture trace and screenshots on failure for debugging
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  expect: {
    // Higher timeout for blockchain operations
    timeout: 30_000,
  },
  // Long timeout for tests involving blockchain transactions
  timeout: 300_000,
  // Only retry in CI to save time locally
  retries: process.env.CI ? 1 : 0,
  projects: [
    // Primary browser for testing
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Additional browsers - only run if installed
    // Uncomment these if you have Firefox and WebKit installed:
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  webServer: {
    command: 'PORT=3000 yarn serve',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
