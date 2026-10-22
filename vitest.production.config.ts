import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    globals: false,
    environment: 'node',
    maxWorkers: 1,
    fileParallelism: false,
    include: [
      'packages/web/test/production-catalog-integration.test.ts',
      'packages/web/test/domain-functions-integration.test.ts',
      'packages/web/test/discovery-privacy-production.test.ts',
      'packages/web/test/catalog-baseline-browser.test.ts',
      'packages/web/test/pdf-first-render-owned.test.ts',
      'packages/web/test/pdf-coordinate-integration-regressions.test.ts',
      'packages/web/test/job-no-tracking.test.ts',
      'packages/web/test/runner-corrections-production.test.ts',
    ],
    exclude: configDefaults.exclude,
  },
});
