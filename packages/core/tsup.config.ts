import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

// WYREUP_CORE_VERSION is part of the public API, so it has to report the
// version actually published. Hardcoding it in source guarantees drift —
// changesets rewrites package.json on release and would never touch the
// literal, which is how it sat at '0.0.0' from the scaffold commit through
// 1.0.0. Read it from the manifest at build time instead, so the two can't
// disagree.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

const define = { __WYREUP_CORE_VERSION__: JSON.stringify(version) };

export default defineConfig([
  // Browser build — uses browser runtime adapter.
  {
    entry: {
      index: 'src/index.ts',
      execution: 'src/execution.ts',
      // Private browser entries keep the static utility providers in separate ESM modules.
      'utility-planning': 'src/utilities/planning.ts',
      'utility-building': 'src/utilities/building.ts',
      'utility-hardware': 'src/utilities/hardware.ts',
      'utility-finance': 'src/utilities/finance.ts',
      'utility-text-developer': 'src/utilities/text-developer.ts',
      'file-worker': 'src/utilities/file-worker-browser.ts',
      'bank-pdf-worker': 'src/utilities/bank-pdf-worker.ts',
    },
    noExternal: [/^pdfjs-dist\/legacy\/build\/pdf(?:\.worker)?\.mjs$/],
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
    entry: {
      index: 'src/index.ts',
      execution: 'src/execution.ts',
      'file-worker': 'src/utilities/file-worker-node.ts',
    },
    noExternal: [/^pdfjs-dist\/legacy\/build\/pdf\.mjs$/],
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist/node',
    platform: 'node',
    target: 'node22',
    define,
    clean: true,
    sourcemap: true,
    treeshake: true,
    esbuildPlugins: [
      {
        name: 'node-file-worker-adapter',
        setup(build) {
          build.onResolve({ filter: /^\.\/file-job-platform\.js$/ }, () => ({
            path: fileURLToPath(new URL('./src/utilities/file-job-node.ts', import.meta.url)),
          }));
          build.onResolve({ filter: /^\.\/bank-pdf-platform\.js$/ }, () => ({
            path: fileURLToPath(new URL('./src/utilities/bank-pdf-node.ts', import.meta.url)),
          }));
        },
      },
    ],
  },
]);
