import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Avoid Node 26 worker-thread crashes in cjsPreparseModuleExports during deploy.
    pool: 'forks',
    setupFiles: ['src/__tests__/setup/vitest-setup.ts'],
    include: [
      'src/__tests__/unit/**/*.test.ts',
      'src/__tests__/integration/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/lib/**',
      'src/__tests__/bdd/**',
    ],
  },
});
