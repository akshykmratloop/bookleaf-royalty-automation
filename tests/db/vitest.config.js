import { defineConfig } from 'vitest/config';

/** Ledger SQL against real Postgres 16 (the local stack's container), in throwaway databases, one file at a time. */
export default defineConfig({
  test: {
    include: ['tests/db/**/*.test.js'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
