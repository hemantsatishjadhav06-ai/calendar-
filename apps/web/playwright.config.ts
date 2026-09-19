import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', timeout: 60_000, retries: process.env.CI ? 2 : 0,
  // PW_EXECUTABLE_PATH lets a CI runner or sandbox point at a pre-installed browser
  // instead of Playwright's pinned download (useful where egress to the browser CDN is blocked).
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'on-first-retry', ...(process.env.PW_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } } : {}) },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'webkit', use: { ...devices['Desktop Safari'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: process.env.CI ? undefined : { command: 'pnpm dev', url: 'http://localhost:3000', reuseExistingServer: true },
});
