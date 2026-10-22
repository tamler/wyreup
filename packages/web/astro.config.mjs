import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import wyreupPwa from './scripts/pwa.mjs';
import onnxAssets from './scripts/onnx-assets.mjs';

export default defineConfig({
  site: 'https://wyreup.com',
  output: 'static',
  integrations: [
    svelte(),
    wyreupPwa({
      manifest: {
        // Stable identity that survives reinstalls and start_url changes.
        // The PWA spec recommends an `id` so the browser can recognize
        // the same app across upgrades; without it, changing start_url
        // creates a "different" PWA in the install database.
        id: '/',
        name: 'Wyreup',
        short_name: 'Wyreup',
        description: 'File tools and calculators. Check each tool for where it processes input and what it needs offline.',
        lang: 'en',
        dir: 'ltr',
        categories: ['productivity', 'utilities'],
        theme_color: '#FAF7F0',
        background_color: '#FAF7F0',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            // Monochrome silhouette tinted by the OS — used by Android 13+
            // themed icons, GNOME Shell badges, and notification badges.
            src: '/pwa-monochrome-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'monochrome',
          },
        ],
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [
              {
                name: 'files',
                accept: ['image/*', 'application/pdf', 'text/*', 'audio/*'],
              },
            ],
          },
        },
        shortcuts: [
          {
            name: 'Browse tools',
            short_name: 'Tools',
            description: 'See all Wyreup tools',
            url: '/tools',
            icons: [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Compress image',
            short_name: 'Compress',
            description: 'Drop and compress an image',
            url: '/tools/compress',
            icons: [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Merge PDFs',
            short_name: 'Merge PDF',
            description: 'Combine PDFs into one',
            url: '/tools/merge-pdf',
            icons: [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Blur faces',
            short_name: 'Face blur',
            description: 'Blur faces in a photo',
            url: '/tools/face-blur',
            icons: [{ src: '/pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        // file_handlers lets the OS offer Wyreup as "open with..." for supported file types.
        // Chromium-only as of April 2026 — Safari and Firefox ignore this field gracefully.
        file_handlers: [
          {
            action: '/share-receive',
            accept: {
              'image/jpeg': ['.jpg', '.jpeg'],
              'image/png': ['.png'],
              'image/webp': ['.webp'],
              'image/heic': ['.heic'],
              'application/pdf': ['.pdf'],
              'audio/wav': ['.wav'],
              'audio/mpeg': ['.mp3'],
            },
          },
        ],
      },
      injectManifest: {
        // Precache core app shell only; large ML WASM/ONNX assets are fetched on demand.
        globPatterns: [
          '**/*.{html,css,js,woff2,svg,png,ico,webmanifest}',
          '**/squoosh_png_bg*.wasm',
        ],
        globIgnores: ['**/*.onnx', 'app-update/index.html', 'app-update.html'],
        // Raise the limit above the 25 MB ort-wasm file so the build doesn't error
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
    }),
  ],
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    plugins: [
      onnxAssets(),
      {
        name: 'wyreup-client-utility-chunks',
        apply: 'build',
        configEnvironment(name, config) {
          if (name !== 'client') return;
          const build = config.build ??= {};
          const options = build.rolldownOptions ??= build.rollupOptions ?? {};
          const output = options.output ??= {};
          if (Array.isArray(output))
            throw new Error('Client utility chunking requires one output configuration.');
          const groups = output.codeSplitting?.groups ?? [];
          if (!Array.isArray(groups))
            throw new Error('Client utility chunk groups must be an array.');
          // Astro sets signatures before this environment hook; preserve its declared exports.
          options.preserveEntrySignatures = 'allow-extension';
          output.strictExecutionOrder = true;
          output.codeSplitting = {
            ...output.codeSplitting,
            groups: [
              {
                test(moduleId) {
                  const normalized = moduleId.replaceAll('\\', '/');
                  const directory = new URL('../core/dist/browser/', import.meta.url).pathname;
                  if (!normalized.startsWith(directory)) return false;
                  const relative = normalized.slice(directory.length);
                  return /^[^?#]+\.js$/.test(relative) &&
                    !['file-worker.js', 'bank-pdf-worker.js'].includes(relative);
                },
                name(moduleId, ctx) {
                  const info = ctx.getModuleInfo(moduleId);
                  if (!info || !Array.isArray(info.exports) ||
                      !info.exports.every(key => typeof key === 'string'))
                    throw new Error('Core provider module information is unavailable.');
                  const families = [
                    ['planningTools', 'utility-planning'],
                    ['buildingTools', 'utility-building'],
                    ['hardwareTools', 'utility-hardware'],
                    ['financeTools', 'utility-finance'],
                    ['textDeveloperTools', 'utility-text-developer'],
                  ].filter(([binding]) => info.exports.includes(binding));
                  if (families.length > 1)
                    throw new Error('Core utility providers must have separate module boundaries.');
                  if (info.exports.includes('createDefaultRegistry')) {
                    if (families.length !== 0)
                      throw new Error('Core registry must be separate from utility providers.');
                    return 'core-registry';
                  }
                  return families[0]?.[1] ?? null;
                },
                // Providers remain statically loaded; shared dependencies keep their own groups.
                includeDependenciesRecursively: false,
              },
              // Keep third-party dependencies outside the two PDF package groups in the client.
              ...groups.map(group =>
                ['pdf-lib', 'pdf-lib-extended'].includes(group.name)
                  ? { ...group, includeDependenciesRecursively: false }
                  : group,
              ),
            ],
          };
        },
      },
    ],
    worker: {
      format: 'es',
      rolldownOptions: {
        external: [
          '@resvg/resvg-js',
          '@napi-rs/canvas',
          'tesseract.js',
          '@mediapipe/tasks-vision',
          'canvas',
          'sharp',
          /^node:/,
          /node_modules\/.*\.node$/,
        ],
      },
    },
    environments: {
      prerender: {
        resolve: {
          // Astro 7 builds static pages in its separate prerender environment.
          external: ['@wyreup/exceljs', '@wyreup/mammoth'],
        },
      },
    },
    ssr: {
      // Keep Node-only native and file/stream libraries outside the SSG bundle.
      // Browser builds select the scoped libraries' rebuilt browser exports.
      external: [
        '@wyreup/exceljs',
        '@wyreup/mammoth',
        '@resvg/resvg-js',
        '@napi-rs/canvas',
        'tesseract.js',
        '@mediapipe/tasks-vision',
        'canvas',
        'sharp',
      ],
      // Prevent Vite from following the noExternal default which would re-include them
      noExternal: [],
    },
    build: {
      rollupOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'pdf-lib', test: /\/node_modules\/pdf-lib\// },
              { name: 'pdf-lib-extended', test: /\/node_modules\/@cantoo\/pdf-lib\// },
              {
                test(moduleId) {
                  const normalized = moduleId.replaceAll('\\', '/');
                  const directory = new URL('../core/dist/browser/', import.meta.url).pathname;
                  return normalized.startsWith(directory) &&
                    /^chunk-[^/?#]+\.js$/.test(normalized.slice(directory.length));
                },
                name(moduleId, ctx) {
                  const info = ctx.getModuleInfo(moduleId);
                  if (!info || !Array.isArray(info.exports))
                    throw new Error('Utility common module information is unavailable.');
                  if (!['UtilityInputError', 'numberParam', 'stringParam'].every((key) => info.exports.includes(key)))
                    return null;
                  if (!Array.isArray(info.importedIds) || info.importedIds.length !== 0)
                    throw new Error('Utility common input must have no static imports.');
                  return 'utility-common';
                },
                includeDependenciesRecursively: true,
              },
            {
              test(moduleId) {
                const normalized = moduleId.replaceAll('\\', '/');
                const directory = new URL('../core/dist/browser/', import.meta.url).pathname;
                return normalized.startsWith(directory) &&
                  /^chunk-[^/?#]+\.js$/.test(normalized.slice(directory.length));
              },
              name(moduleId, ctx) {
                const info = ctx.getModuleInfo(moduleId);
                if (!info || !Array.isArray(info.exports) ||
                    !info.exports.every(key => typeof key === 'string'))
                  throw new Error('Utility calculator shared module information is unavailable.');
                const sets = [
                  ['bmiCategory', 'cancelled', 'cookingBand', 'encoder', 'invalid', 'n', 'parseGradeWeight',
                    'parsePlanningRows', 's', 'safeCsvCell', 'sampleUniqueIntegers', 'seatingCsv', 'secureUint32',
                    'temporalDate', 'temporalInput', 'uniformInteger', 'validateContractParticulars', 'validatePlanningSnapshot'],
                  ['N', 'W', 'buildingChoice', 'buildingCount', 'buildingError', 'buildingN', 'buildingNumber',
                    'buildingResult', 'buildingRows', 'buildingSpecs', 'calculateConstructionEstimate', 'constructionSpecs',
                    'cost', 'n', 'purchaseCeiling', 'validateBoardFootPieces', 'validateBuildingRows',
                    'validateConstructionEstimate', 'validateGutterCandidates'],
                  ['abort', 'validateGeneratorLoads'],
                ];
                return sets.some(keys => info.exports.length === keys.length &&
                  new Set(info.exports).size === info.exports.length && keys.every(key => info.exports.includes(key)))
                  ? 'utility-calculator-shared' : null;
              },
              includeDependenciesRecursively: true,
            },
            ],
          },
        },
        // Native packages are dynamic-imported inside tool run() functions.
        // They must not be bundled into the client chunk — mark as external.
        external: [
          '@resvg/resvg-js',
          '@napi-rs/canvas',
          'tesseract.js',
          '@mediapipe/tasks-vision',
          'canvas',
          'sharp',
          /node_modules\/.*\.node$/,
        ],
      },
    },
    optimizeDeps: {
      include: ['@wyreup/core > papaparse', '@wyreup/core > ag-psd'],
      exclude: [
        '@jsquash/png',
        '@resvg/resvg-js',
        '@napi-rs/canvas',
        'tesseract.js',
        '@mediapipe/tasks-vision',
        'canvas',
        'sharp',
      ],
    },
  },
});
