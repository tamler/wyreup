import { createRequire } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, it, expect } from 'vitest';
import onnxAssets from '../scripts/onnx-assets.mjs';
import manifest from '../../core/src/lib/onnx-assets.json';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const coreRequire = createRequire(join(root, 'packages/core/package.json'));
const hfRequire = createRequire(coreRequire.resolve('@huggingface/transformers'));

describe('pinned ONNX Vite delivery', () => {
  it('fails the build when installed runtime bytes do not match the accepted checksum', async () => {
    const asset = manifest.runtimes[0]?.assets[0];
    if (!asset) throw new Error('Missing checksum rejection fixture');
    const accepted = asset.sha256;
    try {
      asset.sha256 = '0'.repeat(64);
      await expect(onnxAssets().buildStart()).rejects.toThrow('ONNX runtime source mismatch');
    } finally {
      asset.sha256 = accepted;
    }
  });

  it('fails the build when the installed runtime version is not accepted', async () => {
    const runtime = manifest.runtimes[0];
    if (!runtime) throw new Error('Missing version rejection fixture');
    const accepted = runtime.version;
    try {
      runtime.version = '0.0.0-unaccepted';
      await expect(onnxAssets().buildStart()).rejects.toThrow('Unpinned ONNX browser runtime');
    } finally {
      runtime.version = accepted;
    }
  });

  it('builds both actual runtimes and explicit URL imports without local binaries, preserving original licenses and other assets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wyreup-ort-vite-'));
    try {
      const direct = dirname(coreRequire.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'));
      const hf = dirname(hfRequire.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'));
      const entry = join(directory, 'entry.mjs');
      await writeFile(join(directory, 'plain.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
      await writeFile(
        entry,
        [
          `import * as direct from ${JSON.stringify(join(direct, 'ort.bundle.min.mjs'))};`,
          `import * as hf from ${JSON.stringify(join(hf, 'ort.webgpu.bundle.min.mjs'))};`,
          `import binary from ${JSON.stringify(join(direct, 'ort-wasm-simd-threaded.asyncify.wasm') + '?url')};`,
          `import factory from ${JSON.stringify(join(hf, 'ort-wasm-simd-threaded.asyncify.mjs') + '?url')};`,
          "import ordinary from './plain.svg?url';",
          'globalThis.runtimeProbe = { direct, hf, binary, factory, ordinary };',
        ].join('\n'),
      );
      execFileSync(process.execPath, ['--check', entry]);
      const result = await build({
        root: directory,
        configFile: false,
        logLevel: 'error',
        plugins: [onnxAssets()],
        build: {
          write: false,
          minify: false,
          assetsInlineLimit: 0,
          rolldownOptions: { input: entry },
        },
      });
      const outputs = Array.isArray(result)
        ? result.flatMap((item) => item.output)
        : 'output' in result
          ? result.output
          : [];
      const code = outputs
        .filter((item) => item.type === 'chunk')
        .map((item) => item.code)
        .join('\n');
      for (const runtime of manifest.runtimes) {
        expect(code).toContain(
          `https://models.wyreup.com/onnxruntime-web@${runtime.version}/dist/`,
        );
        for (const license of runtime.licenses) {
          const notice = outputs.find(
            (item) =>
              item.fileName === `licenses/onnxruntime-web@${runtime.version}/${license.file}`,
          );
          expect(notice?.type).toBe('asset');
          if (notice?.type !== 'asset') throw new Error('Missing original runtime notice');
          expect(createHash('sha256').update(notice.source).digest('hex')).toBe(license.sha256);
        }
      }
      expect(outputs.some((item) => item.type === 'asset' && item.fileName.endsWith('.wasm'))).toBe(
        false,
      );
      expect(outputs.some((item) => item.type === 'asset' && item.fileName.endsWith('.svg'))).toBe(
        true,
      );
      expect(code).not.toContain('https://models.wyreup.com/plain.svg');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('source manifest matches all actual installed runtime bytes and both immutable upstream notice copies', async () => {
    for (const loader of [coreRequire, hfRequire]) {
      const directory = dirname(loader.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'));
      const installed = JSON.parse(await readFile(join(directory, '../package.json'), 'utf8')) as {
        version: string;
      };
      const runtime = manifest.runtimes.find((item) => item.version === installed.version);
      expect(runtime).toBeDefined();
      if (!runtime) throw new Error('Unpinned runtime');
      for (const asset of runtime.assets) {
        const bytes = await readFile(join(directory, asset.file));
        expect(bytes.length).toBe(asset.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      }
      for (const license of runtime.licenses) {
        const bytes = await readFile(
          join(root, 'packages/web/licenses', `onnxruntime-web@${runtime.version}`, license.file),
        );
        expect(bytes.length).toBe(license.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(license.sha256);
      }
    }
  });
});
