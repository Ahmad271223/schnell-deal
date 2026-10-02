import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-End-Test gegen echte Server mit eigener Datenbank (schnelldeal_e2e) und eigenem Bucket.
 * API: http://localhost:4100 · Web (Produktions-Build): http://localhost:3100
 */
const API_PORT = 4100;
const WEB_PORT = 3100;
export const E2E = {
  api: `http://localhost:${API_PORT}`,
  web: `http://localhost:${WEB_PORT}`,
  databaseUrl: 'postgres://schnelldeal:schnelldeal@localhost:55432/schnelldeal_e2e',
  adminEmail: 'e2e-admin@schnell-deal.local',
  adminPassword: 'E2e-Admin-Pass-2026',
};

const apiEnv = {
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  DATABASE_URL: E2E.databaseUrl,
  S3_BUCKET: 'schnelldeal-test',
  ALLOWED_ORIGINS: E2E.web,
  PUBLIC_WEB_URL: E2E.web,
  RATE_LIMIT_DISABLED: 'true',
  WORKER_MODE: 'inline',
  SCHEDULER_ENABLED: 'true',
  LOG_LEVEL: 'warn',
  SEED_ADMIN_EMAIL: E2E.adminEmail,
  SEED_ADMIN_PASSWORD: E2E.adminPassword,
};

export default defineConfig({
  testDir: './tests',
  timeout: 10 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: E2E.web,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node scripts/reset-db.mjs && pnpm --filter @sd/api exec tsx src/scripts/seed.ts && node scripts/serve.mjs api pnpm --filter @sd/api exec tsx src/server.ts',
      url: `${E2E.api}/api/v1/health`,
      env: apiEnv,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'pnpm --filter @sd/web exec next build && node scripts/serve.mjs web pnpm --filter @sd/web exec next start -p 3100',
      url: E2E.web + '/login',
      env: { NEXT_DIST_DIR: '.next-e2e', API_INTERNAL_URL: E2E.api, NEXT_PUBLIC_WS_URL: `ws://localhost:${API_PORT}/api/v1/ws`, NEXT_TELEMETRY_DISABLED: '1' },
      timeout: 600_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
  ],
});
