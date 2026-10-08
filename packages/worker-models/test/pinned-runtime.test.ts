import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, it, expect } from 'vitest';
import manifest from '../../core/src/lib/onnx-assets.json';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const rootRequire = createRequire(resolve(root, 'package.json'));
const wranglerRequire = createRequire(rootRequire.resolve('wrangler'));
const coreRequire = createRequire(resolve(root, 'packages/core/package.json'));
interface LocalRuntime {
  dispatchFetch(url: string, init?: { method: string }): Promise<Response>;
  getR2Bucket(name: string): Promise<R2Bucket>;
  dispose(): Promise<void>;
}
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare') as {
  Miniflare: new (options: unknown) => LocalRuntime;
  convertV4MiniflareOptions: (options: unknown) => unknown;
};
const version = '1.24.3';
const file = 'ort-wasm-simd-threaded.mjs';
const asset = manifest.runtimes
  .find((item) => item.version === version)
  ?.assets.find((item) => item.file === file);
if (!asset) throw new Error('Missing pinned integration fixture');
const key = `onnxruntime-web@${version}/dist/${file}`;
const url = `https://models.wyreup.com/${key}`;
const original = new Uint8Array(await readFile(coreRequire.resolve(`onnxruntime-web/${file}`)));
const bundle = await build({
  entryPoints: [resolve(root, 'packages/worker-models/src/index.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
});
const script = bundle.outputFiles[0]?.text;
if (!script) throw new Error('Worker bundle missing');

function checksum(bytes?: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes ?? new ArrayBuffer(0)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function runtime(body: Uint8Array = original, headers: Record<string, string> = {}) {
  const requests: Request[] = [];
  const instance = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: '2026-05-15',
      r2Buckets: ['MODELS'],
      outboundService: (request: Request) => {
        requests.push(request);
        return new Response(Uint8Array.from(body).buffer, { headers });
      },
    }),
  );
  return { instance, requests };
}

describe('pinned runtime native workerd/R2 integration', () => {
  it('verifies a cold stream natively, serves exact bytes, then GET/HEAD hits verified R2', async () => {
    const { instance, requests } = runtime(original, {
      'Content-Length': String(original.byteLength),
    });
    try {
      const first = await instance.dispatchFetch(url);
      expect(first.status).toBe(200);
      expect(first.headers.get('X-Wyreup-Cache')).toBe('miss');
      expect(first.headers.get('X-Wyreup-Verified')).toBe(asset.sha256);
      expect(new Uint8Array(await first.arrayBuffer())).toEqual(original);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.headers.get('Accept-Encoding')).toBe('identity');
      const bucket = await instance.getR2Bucket('MODELS');
      const stored = await bucket.head(key);
      expect(stored?.size).toBe(asset.bytes);
      expect(checksum(stored?.checksums.sha256)).toBe(asset.sha256);
      const hit = await instance.dispatchFetch(url);
      expect(hit.status).toBe(200);
      expect(hit.headers.get('X-Wyreup-Cache')).toBe('hit');
      await hit.arrayBuffer();
      const head = await instance.dispatchFetch(url, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('Content-Length')).toBe(String(asset.bytes));
      expect(await head.text()).toBe('');
      expect(requests).toHaveLength(1);
    } finally {
      await instance.dispose();
    }
  });

  it.each(['short', 'long', 'tampered'] as const)(
    'rejects %s upstream bytes through native length/checksum validation',
    async (kind) => {
      const bytes =
        kind === 'short'
          ? original.subarray(0, original.length - 1)
          : kind === 'long'
            ? new Uint8Array([...original, 0])
            : Uint8Array.from(original);
      if (kind === 'tampered') bytes[0] ^= 1;
      const { instance } = runtime(bytes);
      try {
        const response = await instance.dispatchFetch(url);
        expect(response.status).toBe(502);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.text()).toBe('Pinned runtime asset verification failed');
        expect(await (await instance.getR2Bucket('MODELS')).head(key)).toBeNull();
      } finally {
        await instance.dispose();
      }
    },
  );

  it.each(['wrong-size', 'wrong-hash', 'valid'] as const)(
    'handles %s unverified pre-existing objects without trusting custom metadata',
    async (kind) => {
      const { instance, requests } = runtime();
      try {
        const bucket = await instance.getR2Bucket('MODELS');
        const body = kind === 'wrong-size' ? original.subarray(1) : Uint8Array.from(original);
        if (kind === 'wrong-hash') body[0] ^= 1;
        await bucket.put(key, body, { customMetadata: { sha256: asset.sha256 } });
        const response = await instance.dispatchFetch(url);
        expect(response.status).toBe(kind === 'valid' ? 200 : 502);
        if (kind === 'valid') {
          expect(new Uint8Array(await response.arrayBuffer())).toEqual(original);
          const stored = await bucket.head(key);
          expect(checksum(stored?.checksums.sha256)).toBe(asset.sha256);
        } else {
          expect(response.headers.get('Cache-Control')).toBe('no-store');
          expect(await bucket.head(key)).toBeNull();
          await response.text();
        }
        expect(requests).toHaveLength(0);
      } finally {
        await instance.dispose();
      }
    },
  );

  it('refuses compressed upstream and unknown/version/path keys before publishing or legacy routing', async () => {
    const { instance, requests } = runtime(original, { 'Content-Encoding': 'gzip' });
    try {
      const compressed = await instance.dispatchFetch(url);
      expect(compressed.status).toBe(502);
      await compressed.text();
      for (const path of [
        'onnxruntime-web@999/dist/' + file,
        key + '.extra',
        'onnxruntime-web@1.24.3/dist/other.wasm',
      ]) {
        const response = await instance.dispatchFetch('https://models.wyreup.com/' + path);
        expect(response.status).toBe(403);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        await response.text();
      }
      expect(requests).toHaveLength(1);
    } finally {
      await instance.dispose();
    }
  });

  it('publishes only verified bytes when two cold requests arrive together', async () => {
    const { instance } = runtime();
    try {
      const responses = await Promise.all([
        instance.dispatchFetch(url),
        instance.dispatchFetch(url),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(original);
        expect(response.headers.get('X-Wyreup-Verified')).toBe(asset.sha256);
      }
    } finally {
      await instance.dispose();
    }
  });
});
