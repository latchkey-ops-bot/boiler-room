import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    // The API tests start a local D1 in workerd once per file.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
