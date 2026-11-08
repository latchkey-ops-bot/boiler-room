import { defineConfig, devices } from '@playwright/test';

/**
 * The smoke test. Locally it builds the Worker and runs it on workerd with `pnpm web:preview`:
 *   pnpm web:test:smoke
 * Against a deployed environment, give it the URL and it starts nothing:
 *   BASE_URL=https://boiler-room-web-staging.<account>.workers.dev pnpm web:test:smoke
 */
const baseURL = process.env.BASE_URL ?? 'http://localhost:8787';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'node scripts/preview.mjs',
        url: `${baseURL}/api/health`,
        reuseExistingServer: true,
        timeout: 600_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
