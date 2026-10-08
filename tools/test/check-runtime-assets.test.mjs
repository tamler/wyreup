import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { checkRuntimeAssets, verifyRuntimeResponse } from '../check-runtime-assets.mjs';

const payload = new TextEncoder().encode('pinned runtime bytes');
const runtime = { version: 'test-version' };
const asset = {
  file: 'test.wasm',
  bytes: payload.length,
  sha256: createHash('sha256').update(payload).digest('hex'),
};
const response = (body = payload, overrides = {}) =>
  new Response(body, {
    status: 200,
    headers: {
      'X-Wyreup-Verified': asset.sha256,
      'X-Wyreup-Runtime-Version': runtime.version,
      'X-Wyreup-Cache': 'hit',
      ...overrides,
    },
  });

it('verifies actual bytes even when verification headers claim success', async () => {
  await expect(verifyRuntimeResponse(response(), runtime, asset, true)).resolves.toBeUndefined();
  const forged = new Uint8Array(payload);
  forged[0] ^= 1;
  await expect(verifyRuntimeResponse(response(forged), runtime, asset, true)).rejects.toThrow(
    /checksum/,
  );
});

it('rejects truncated and oversized responses', async () => {
  await expect(verifyRuntimeResponse(response(payload.slice(1)), runtime, asset)).rejects.toThrow(
    /length/,
  );
  await expect(
    verifyRuntimeResponse(response(new Uint8Array(payload.length + 1)), runtime, asset),
  ).rejects.toThrow(/length/);
});

it('requires a verified cache hit, the exact version and successful status', async () => {
  await expect(
    verifyRuntimeResponse(response(payload, { 'X-Wyreup-Cache': 'miss' }), runtime, asset, true),
  ).rejects.toThrow();
  await expect(
    verifyRuntimeResponse(
      response(payload, { 'X-Wyreup-Runtime-Version': 'different' }),
      runtime,
      asset,
    ),
  ).rejects.toThrow();
  await expect(
    verifyRuntimeResponse(new Response('upstream failed', { status: 502 }), runtime, asset),
  ).rejects.toThrow(/Runtime asset failed/);
});

it('requires both complete inventories and checks each pinned URL twice in order', async () => {
  const assets = Array.from({ length: 8 }, (_, index) => ({
    ...asset,
    file: `asset-${index}.wasm`,
  }));
  const runtimes = [runtime, runtime].map((item) => ({ ...item, assets }));
  const calls = [];
  await expect(
    checkRuntimeAssets({ runtimes }, async (url, options) => {
      calls.push(url);
      expect(options.redirect).toBe('error');
      return response();
    }),
  ).resolves.toBe(16);
  expect(calls).toHaveLength(32);
  expect(calls[0]).toBe('https://models.wyreup.com/onnxruntime-web@test-version/dist/asset-0.wasm');
  expect(calls[1]).toBe(calls[0]);
  await expect(checkRuntimeAssets({ runtimes: [] })).rejects.toThrow(/complete pinned/);
});
