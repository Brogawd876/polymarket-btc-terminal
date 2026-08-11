import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'src/**/*.test.ts', 'apps/**/src/**/*.test.ts'],
    fileParallelism: false,
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/dist/**'],
    server: {
      deps: {
        external: ['ws', 'better-sqlite3']
      }
    }
  },
});
