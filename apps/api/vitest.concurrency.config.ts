import { defineConfig } from 'vitest/config';
import { testEnv } from './vitest.config';

export default defineConfig({
  test: {
    env: { ...testEnv, DATABASE_POOL_MAX: '30' },
    globalSetup: ['./test/global-setup.ts'],
    include: ['test/concurrency/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
