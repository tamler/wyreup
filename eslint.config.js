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
    ignores: [
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
      '**/env.d.ts',
    ],
  },
);
