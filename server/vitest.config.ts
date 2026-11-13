import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/setup/globalSetup.ts'],
    setupFiles: ['./test/setup/env.ts'],
    // One shared Postgres test database: run files one at a time in a single worker.
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
