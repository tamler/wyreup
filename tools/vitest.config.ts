import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // globalSetup runs before tests and sets cwd to repo root so relative paths resolve correctly.
    globalSetup: ['./test/setup.mjs'],
  },
});
