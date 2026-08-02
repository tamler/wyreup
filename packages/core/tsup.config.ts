import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// WYREUP_CORE_VERSION is part of the public API, so it has to report the
// version actually published. Hardcoding it in source guarantees drift —
// changesets rewrites package.json on release and would never touch the
// literal, which is how it sat at '0.0.0' from the scaffold commit through
// 1.0.0. Read it from the manifest at build time instead, so the two can't
// disagree.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const define = { __WYREUP_CORE_VERSION__: JSON.stringify(version) };

export default defineConfig([
  // Browser build — uses browser runtime adapter.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    outDir: 'dist/browser',
    platform: 'browser',
    target: 'es2022',
    define,
    clean: true,
    sourcemap: true,
    treeshake: true,
  },
  // Node build — uses node runtime adapter.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist/node',
    platform: 'node',
    target: 'node20',
    define,
    sourcemap: true,
    treeshake: true,
  },
]);
