import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // CLI command files use console.log as their primary output channel —
    // that's the point of a CLI. Allow it there only.
    files: ['packages/cli/src/commands/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Tool modules implement `async run(...)` because the ToolModule contract
    // requires Promise<Blob[]>. Many tools are CPU-only and have no genuine
    // await — require-await flags those as false positives.
    files: ['packages/core/src/tools/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['packages/exceljs/**/*.cjs', 'packages/mammoth/**/*.cjs', '.pnpmfile.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { __dirname: 'readonly', process: 'readonly', Buffer: 'readonly', Blob: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['packages/exceljs/src/**/*.mjs', 'packages/mammoth/src/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: [
      'tools/check-runner-coverage.mjs',
      'tools/check-catalog-evidence.mjs',
      'tools/catalog-baseline-producers.mjs',
      'tools/check-release-readiness.mjs',
      'tools/test/check-runner-coverage.test.mjs',
      'tools/test/catalog-evidence.test.mjs',
      'tools/test/catalog-existing-engines.test.mjs',
      'tools/test/catalog-packaged-workers.test.mjs',
      'tools/check-privacy.mjs',
      'tools/test/pdfjs-notices-integration.test.mjs',
      'tools/test/check-release-readiness.test.mjs',
      'packages/web/scripts/production-headers.mjs',
      'packages/web/test/domainFunctionsHarness.mjs',
      'packages/web/test/productionBuildBindingObserver.mjs',
      'packages/web/test/fixtures/owned-cache-config.mjs',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: 'module',
      globals: {
        process: 'readonly', console: 'readonly', Buffer: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly', File: 'readonly',
        fetch: 'readonly', Request: 'readonly', Response: 'readonly', Headers: 'readonly',
        AbortController: 'readonly', DOMException: 'readonly', TextDecoder: 'readonly',
        TextEncoder: 'readonly', crypto: 'readonly', performance: 'readonly', structuredClone: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
      },
    },
    rules: { 'no-console': ['warn', { allow: ['log', 'warn', 'error'] }] },
  },
  {
    ignores: [
      'docs/catalog-artifacts/**',
      'packages/*/vendor/**',
      'packages/*/.excel-build-*/**',
      'packages/*/.mammoth-build-*/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/.astro/**',
      '**/.turbo/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.ts',
      '**/tools/**/*.js',
      '**/tools/**/*.mjs',
      '**/scripts/**/*.mjs',
      '!tools/check-runner-coverage.mjs',
      '!tools/check-catalog-evidence.mjs',
      '!tools/catalog-baseline-producers.mjs',
      '!tools/check-release-readiness.mjs',
      '!tools/test/check-runner-coverage.test.mjs',
      '!tools/test/catalog-evidence.test.mjs',
      '!tools/test/catalog-existing-engines.test.mjs',
      '!tools/test/catalog-packaged-workers.test.mjs',
      '!tools/check-privacy.mjs',
      '!tools/test/pdfjs-notices-integration.test.mjs',
      '!tools/test/check-release-readiness.test.mjs',
      '!packages/web/scripts/production-headers.mjs',
      '!packages/web/test/fixtures/owned-cache-config.mjs',
      '**/test/fixtures/**/*.js',
      '**/env.d.ts',
    ],
  },
);
