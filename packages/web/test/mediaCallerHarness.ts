import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { chromium } from 'playwright';

/** Controlled native promises and registry prices; actual caller components and chain engine. */
export async function openMediaCallerHarness(
  component = './test/fixtures/MediaCallerHarness.svelte',
) {
  const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await build({
    stdin: {
      contents: `import { mount } from 'svelte'; import Harness from ${JSON.stringify(component)}; mount(Harness,{target:document.getElementById('app')});`,
      loader: 'ts',
      resolveDir: web,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    conditions: ['browser'],
    alias: {
      '@wyreup/core/execution': resolve(web, 'test/fixtures/mediaCallerCore.ts'),
      '@wyreup/core': resolve(web, 'test/fixtures/mediaCallerCore.ts'),
    },
    plugins: [
      {
        name: 'actual-media-callers',
        setup(builder) {
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
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(
      request.url === '/app.js'
        ? result.outputFiles[0].text
        : '<!doctype html><html><meta charset="utf-8"><div id="app"></div><script type="module" src="/app.js"></script></html>',
    );
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Owned server unavailable.');
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
