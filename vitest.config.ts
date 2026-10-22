import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    maxWorkers: 4,
    exclude: [
      ...configDefaults.exclude,
      'packages/exceljs/test/**',
      'packages/mammoth/test/**',
      'tools/test/catalog-packaged-workers.test.mjs',
      'tools/test/catalog-existing-engines.test.mjs',
      'tools/test/catalog-evidence.test.mjs',
      'tools/test/catalog-browser-production-binding.test.mjs',
      'tools/test/catalog-browser-binding-followup.test.mjs',
      'tools/test/catalog-browser-binding-parser-followup.test.mjs',
      'tools/test/catalog-core-build-proof.test.mjs',
      '**/production-catalog-integration.test.ts',
      '**/domain-functions-integration.test.ts',
      '**/discovery-privacy-production.test.ts',
      '**/catalog-baseline-browser.test.ts',
      '**/pdf-first-render-owned.test.ts',
      '**/pdf-coordinate-integration-regressions.test.ts',
      '**/job-no-tracking.test.ts',
      '**/runner-corrections-production.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.config.*', '**/test-fixtures/**'],
    },
  },
});
