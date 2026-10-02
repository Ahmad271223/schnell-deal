import { defineConfig } from 'vitest/config';

export const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://schnelldeal:schnelldeal@localhost:55432/schnelldeal_test',
  S3_BUCKET: 'schnelldeal-test',
  RATE_LIMIT_DISABLED: 'true',
  WORKER_MODE: 'off',
  SCHEDULER_ENABLED: 'false',
  LOG_LEVEL: 'warn',
  SMTP_PORT: '1025',
};

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: ['./test/global-setup.ts'],
    include: ['test/**/*.test.ts'],
    exclude: ['test/concurrency/**'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
