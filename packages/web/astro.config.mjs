import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import AstroPWA from '@vite-pwa/astro';

export default defineConfig({
  site: 'https://wyreup.com',
  output: 'static',
  integrations: [
    svelte(),
    AstroPWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: {
        name: 'Wyreup',
        short_name: 'Wyreup',
        description: 'Privacy-first file tools. Everything runs in your browser.',
        theme_color: '#FFB000',
        background_color: '#111113',
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
        globPatterns: ['**/*.{html,css,js,woff2,svg,png,ico,webmanifest}'],
        globIgnores: ['**/*.wasm', '**/*.onnx'],
        // Raise the limit above the 25 MB ort-wasm file so the build doesn't error
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    ssr: {
      // These packages contain native .node binaries. Vite/Rollup cannot bundle
      // them — externalize so they are resolved at runtime by Node instead.
      // They are only invoked inside tool run() functions, not during SSG.
      external: [
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
      exclude: [
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
