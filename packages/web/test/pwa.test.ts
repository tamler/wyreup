import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildPwa } from '../scripts/pwa.mjs';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
describe('native PWA build', () => {
  it('preserves manifest and registration while injecting canonical precache routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wyreup-pwa-test-'));
    directories.push(root);
    const outDir = join(root, 'dist');
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(outDir, 'offline'), { recursive: true });
    await mkdir(join(outDir, 'tools', 'compress'), { recursive: true });
    await mkdir(join(outDir, '_astro'), { recursive: true });
    await writeFile(join(root, 'src', 'sw.ts'), 'self.testManifest = self.__WB_MANIFEST;');
    await writeFile(join(outDir, 'index.html'), '<h1>Home</h1>');
    await writeFile(join(outDir, 'offline', 'index.html'), '<h1>Offline</h1>');
    await writeFile(join(outDir, 'tools', 'compress', 'index.html'), '<h1>Compress</h1>');
    await writeFile(join(outDir, '_astro', 'app.hash.css'), 'body {color:black}');
    await writeFile(join(outDir, 'model.wasm'), 'large model');
    const manifest = {
      id: '/',
      name: 'Wyreup',
      scope: '/',
      start_url: '/',
      share_target: { action: '/share', method: 'POST' },
      file_handlers: [{ action: '/share-receive' }],
      icons: [{ src: '/pwa-192.png' }],
    };
    const result = await buildPwa({
      root,
      outDir,
      manifest,
      precache: {
        globPatterns: ['**/*.{html,css,js,webmanifest}'],
        globIgnores: ['**/*.wasm', '**/*.onnx'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
      format: 'directory',
      trailingSlash: 'ignore',
      assets: '_astro',
    });
    expect(result.warnings).toEqual([]);
    expect(JSON.parse(await readFile(join(outDir, 'manifest.webmanifest'), 'utf8'))).toEqual(
      manifest,
    );
    const registration = await readFile(join(outDir, 'registerSW.js'), 'utf8');
    expect(registration).toContain("register('/sw.js', { scope: '/' })");
    expect(registration).not.toContain('skipWaiting');
    const self: { testManifest?: Array<{ url: string; revision: string | null }> } = {};
    runInNewContext(await readFile(join(outDir, 'sw.js'), 'utf8'), { self });
    const entries = self.testManifest!;
    expect(entries.map((entry) => entry.url)).toEqual(
      expect.arrayContaining([
        '/',
        'offline',
        'tools/compress',
        'registerSW.js',
        'manifest.webmanifest',
        '_astro/app.hash.css',
      ]),
    );
    expect(entries.some((entry) => /\.wasm$|^sw\.js$|index\.html/.test(entry.url))).toBe(false);
    expect(entries.find((entry) => entry.url === '_astro/app.hash.css')?.revision).toBeNull();
    expect(entries.find((entry) => entry.url === 'offline')?.revision).toMatch(/^[a-f0-9]+$/);
  });
});
