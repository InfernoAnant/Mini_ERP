import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/setup/globalSetup.ts'],
    setupFiles: ['./test/setup/env.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
