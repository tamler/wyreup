import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    exclude: [
      ...configDefaults.exclude,
      'test/catalog-evidence.test.mjs',
      'test/catalog-existing-engines.test.mjs',
      'test/catalog-packaged-workers.test.mjs',
      'test/catalog-browser-production-binding.test.mjs',
      'test/catalog-browser-binding-followup.test.mjs',
      'test/catalog-browser-binding-parser-followup.test.mjs',
      'test/catalog-core-build-proof.test.mjs',
    ],
    // globalSetup runs before tests and sets cwd to repo root so relative paths resolve correctly.
    globalSetup: ['./test/setup.mjs'],
  },
});
