import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     false,
    environment: 'node',
    include:     ['src/__tests__/**/*.test.ts'],
    globalSetup: './vitest.global-setup.ts',
    // Sequential — suites share one Postgres DB; parallel files would stomp each
    // other's reset/seed state. singleFork keeps one process; fileParallelism:false
    // guarantees files run one-at-a-time within it.
    singleFork:      true,
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Keep isDev = true so /dev/act-as role-switcher is available to tests
    env: { NODE_ENV: 'development' },
  },
});
