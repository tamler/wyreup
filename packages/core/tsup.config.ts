import { defineConfig } from 'tsup';

export default defineConfig([
  // Browser build — uses browser runtime adapter.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    outDir: 'dist/browser',
    platform: 'browser',
    target: 'es2022',
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
    sourcemap: true,
    treeshake: true,
  },
]);
