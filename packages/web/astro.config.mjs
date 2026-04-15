import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://wyreup.com',
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
  },
});
