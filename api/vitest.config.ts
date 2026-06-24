import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     false,
    environment: 'node',
    include:     ['src/__tests__/**/*.test.ts'],
    // Sequential — tests share DB state and a single test server on port 3998
    singleFork:  true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Keep isDev = true so /dev/act-as role-switcher is available to tests
    env: { NODE_ENV: 'development' },
  },
});
