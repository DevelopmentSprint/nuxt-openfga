import { defineConfig } from 'vitest/config'

// Builds the playground and drives it over HTTP. Slower than the unit suite,
// so it runs separately: `pnpm test:e2e`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/e2e/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 240_000,
  },
})
