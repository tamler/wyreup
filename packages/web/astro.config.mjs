import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

export default defineConfig({
  site: 'https://wyreup.com',
  output: 'static',
  integrations: [svelte()],
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
