import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { chromium } from 'playwright';

/** Current runner source and the actual browser package/default registry, without a source alias. */
export async function openLegacyFileAdmissionHarness() {
  const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const core = resolve(web, '../core/dist/browser');
  const nativeBuiltins = new Set([
    ...builtinModules,
    ...builtinModules.map((name) => `node:${name}`),
  ]);
  const entry = await build({
    stdin: {
      contents:
        "import { mount } from 'svelte'; import Harness from './test/fixtures/LegacyFileAdmissionHarness.svelte'; mount(Harness,{target:document.getElementById('app')});",
      resolveDir: web,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    conditions: ['browser'],
    target: 'es2022',
    // Same native package exclusions as actual Astro client config, plus Node builtins.
    // These remain unavailable if a browser run actually enters a Node-only branch.
    external: [
      '@resvg/resvg-js',
      '@napi-rs/canvas',
      'tesseract.js',
      '@mediapipe/tasks-vision',
      'canvas',
      'sharp',
    ],
    plugins: [
      {
        name: 'actual-legacy-file-runners',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            nativeBuiltins.has(path) ? { path, external: true } : undefined,
          );
          builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
            contents: compile(await readFile(path, 'utf8'), {
              filename: path,
              generate: 'client',
              css: 'injected',
              dev: true,
            }).js.code,
            loader: 'js',
            resolveDir: dirname(path),
          }));
        },
      },
    ],
  });
  const pngWasm = resolve(web, '../core/node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm');
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      if (path === '/app.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(entry.outputFiles[0].text);
      } else if (path === '/core/squoosh_png_bg.wasm' || path === '/squoosh_png_bg.wasm') {
        response.setHeader('Content-Type', 'application/wasm');
        response.end(await readFile(pngWasm));
      } else if (path.startsWith('/core/')) {
        const file = resolve(core, decodeURIComponent(path.slice(6)));
        if (!file.startsWith(core + sep) || !file.endsWith('.js')) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.setHeader('Content-Type', 'text/javascript');
        response.end(await readFile(file));
      } else if (path === '/') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(
          '<!doctype html><html lang="en"><meta charset="utf-8"><title>Actual package legacy admission</title><script type="importmap">{"imports":{"@wyreup/core":"/core/index.js"}}</script><div id="app"></div><script type="module" src="/app.js"></script></html>',
        );
      } else {
        response.writeHead(404);
        response.end();
      }
    })().catch(() => {
      response.writeHead(404);
      response.end();
    });
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Owned admission server unavailable.');
  try {
    const browser = await chromium.launch({ headless: true });
    return {
      browser,
      url: `http://127.0.0.1:${address.port}`,
      async close() {
        await browser.close();
        server.closeAllConnections();
        await new Promise<void>((done, reject) => {
          server.close((error) => (error ? reject(error) : done()));
        });
      },
    };
  } catch (error) {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    throw error;
  }
}
