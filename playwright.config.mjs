import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4321/SgtXLHC/', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: { command: 'npm run build:project && ASTRO_BASE=/SgtXLHC npm run preview -- --host 127.0.0.1 --port 4321', url: 'http://127.0.0.1:4321/SgtXLHC/', reuseExistingServer: false, timeout: 60000 },
});
