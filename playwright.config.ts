import { defineConfig, devices } from '@playwright/test';
import { env } from './tests/data/environments';

// Target environment comes from tests/data/environments.json, chosen by TEST_ENV (staging | live)
// or by the positional argument in scripts/run-tests.js. BASE_URL still overrides for one-off runs.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? env.portal.baseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
