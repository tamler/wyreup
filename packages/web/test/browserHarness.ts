import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { chromium } from 'playwright';

export async function openBrowserHarness(component: string, options: { fileWorker?: boolean } = {}) {
  const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const compiled = await build({
    stdin: {
      contents: `import { mount } from 'svelte'; import Harness from ${JSON.stringify(component)}; mount(Harness, { target: document.getElementById('app') });`,
      resolveDir: web,
      sourcefile: 'acceptance-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    conditions: ['browser'],
    alias: {
      '@wyreup/core/execution': resolve(web, 'test/fixtures/utilityCore.ts'),
      '@wyreup/core': resolve(web, 'test/fixtures/utilityCore.ts'),
    },
    plugins: [
      {
        name: 'mounted-svelte',
        setup(builder) {
          builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
            const output = compile(await readFile(path, 'utf8'), {
              filename: path,
              generate: 'client',
              css: 'injected',
              dev: true,
            });
            return { contents: output.js.code, loader: 'js', resolveDir: dirname(path) };
          });
        },
      },
    ],
  });
  const worker = options.fileWorker ? await build({
    entryPoints: [resolve(web, '../core/src/utilities/file-worker-browser.ts')],
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['browser'], external: ['@napi-rs/canvas', 'node:*'],
  }) : null;
  const pdfWorker = options.fileWorker ? await build({
    entryPoints: [resolve(web, '../core/src/utilities/bank-pdf-worker.ts')],
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['browser'],
  }) : null;
  const pngWasm = options.fileWorker
    ? await readFile(resolve(web, '../core/node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm'))
    : null;
  if (pngWasm && pngWasm.length !== 181088) throw new Error('Unexpected acceptance PNG WASM size.');
  const server = createServer((request, response) => {
    if (request.url === '/squoosh_png_bg.wasm' && pngWasm) {
      response.setHeader('Content-Type', 'application/wasm');
      response.end(pngWasm);
      return;
    }
    if (request.url === '/bank-pdf-worker.js' && pdfWorker) {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(pdfWorker.outputFiles[0].text);
      return;
    }
    if (request.url === '/file-worker.js' && worker) {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(worker.outputFiles[0].text);
      return;
    }
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(
      request.url === '/app.js'
        ? compiled.outputFiles[0].text
        : '<!doctype html><html lang="en"><meta charset="utf-8"><title>Mounted acceptance</title><div id="app"></div><script type="module" src="/app.js"></script></html>',
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Acceptance server unavailable.');
  try {
    const browser = await chromium.launch({ headless: true });
    return {
      browser,
      url: `http://127.0.0.1:${address.port}`,
      async close() {
        await browser.close();
        await new Promise<void>((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
      },
    };
  } catch (error) {
    await new Promise<void>((done) => server.close(() => done()));
    throw error;
  }
}
