import { defineConfig } from 'vitest/config';

/** Contract tests hit a live n8n: one file at a time, generous timeouts (AI + SMTP round trips). */
export default defineConfig({
  test: {
    include: ['tests/contract/**/*.test.js'],
    fileParallelism: false,
    testTimeout: 150_000,
    hookTimeout: 240_000,
  },
});
