import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env['CI'];

/**
 * Testy E2E całej aplikacji (front + API + baza + Mailpit).
 * Lokalnie używają już uruchomionych serwerów (`npm run dev`), w CI startują je same.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'pl-PL',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    // Safari/iOS - w CI (lokalnie wymaga `npx playwright install webkit`)
    ...(isCI ? [{ name: 'mobile-safari', use: { ...devices['iPhone 15'] } }] : []),
  ],
  webServer: [
    {
      command: 'npm run start:dev --prefix backend',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: !isCI,
      // Równoległe testy logują się z jednego IP
      env: { THROTTLE_ENABLED: 'false' },
      timeout: 120_000,
    },
    {
      command: 'npm start --prefix frontend',
      url: 'http://localhost:4200',
      reuseExistingServer: !isCI,
      timeout: 180_000,
    },
  ],
});
