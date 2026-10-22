import { fileURLToPath } from 'node:url';
import production from './astro.config.mjs';
export default {
  ...production,
  cacheDir: fileURLToPath(new URL('./.acceptance-cache/astro/', import.meta.url)),
  vite: {
    ...production.vite,
    cacheDir: fileURLToPath(new URL('./.acceptance-cache/vite/', import.meta.url)),
  },
};
