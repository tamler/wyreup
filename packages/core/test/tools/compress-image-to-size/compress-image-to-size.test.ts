import { describe, it, expect } from 'vitest';
import { compressImageToSize } from '../../../src/tools/compress-image-to-size/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test-exec-id',
  };
}

describe('compress-image-to-size — metadata', () => {
  it('has the expected id and category', () => {
    expect(compressImageToSize.id).toBe('compress-image-to-size');
    expect(compressImageToSize.category).toBe('optimize');
  });

  it('paramSchema covers every defaults key', () => {
    for (const key of Object.keys(compressImageToSize.defaults)) {
      expect(compressImageToSize.paramSchema, key).toHaveProperty(key);
    }
  });
});

describe('compress-image-to-size — run()', () => {
  it('compresses a JPEG under the KB target', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    expect(input.size).toBeGreaterThan(15 * 1024);
    const outputs = await compressImageToSize.run([input], { targetKb: 15 }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs.length).toBe(1);
    expect(blobs[0]!.type).toBe('image/jpeg');
    expect(blobs[0]!.size).toBeLessThanOrEqual(15 * 1024);
    expect(blobs[0]!.size).toBeGreaterThan(0);
  });

  it('returns the original bytes untouched when already under target', async () => {
    const input = loadFixture('photo.webp', 'image/webp');
    const targetKb = Math.ceil(input.size / 1024) + 100;
    const outputs = await compressImageToSize.run([input], { targetKb }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    const roundTripped = new Uint8Array(await blobs[0]!.arrayBuffer());
    const original = new Uint8Array(await input.arrayBuffer());
    expect(roundTripped).toEqual(original);
  });

  it('converts an over-target PNG to JPEG to reach the target', async () => {
    // Noise compresses terribly in PNG, giving a comfortably over-target input.
    const { getCodec } = await import('../../../src/lib/codecs.js');
    const png = await getCodec('png');
    const width = 400;
    const height = 300;
    const data = new Uint8ClampedArray(width * height * 4);
    let seed = 42;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      data[i] = i % 4 === 3 ? 255 : seed % 256;
    }
    const bytes = await png.encode({ data, width, height }, { quality: 100 });
    const input = new File([bytes], 'noise.png', { type: 'image/png' });
    expect(input.size).toBeGreaterThan(50 * 1024);
    const outputs = await compressImageToSize.run([input], { targetKb: 50 }, makeCtx());
    const blobs = Array.isArray(outputs) ? outputs : [outputs];
    expect(blobs[0]!.type).toBe('image/jpeg');
    expect(blobs[0]!.size).toBeLessThanOrEqual(50 * 1024);
  });

  it('throws a readable error for unsupported input', async () => {
    const junk = new File([new Uint8Array([9, 9, 9])], 'x.gif', { type: 'image/gif' });
    await expect(compressImageToSize.run([junk], {}, makeCtx())).rejects.toThrow(/Unsupported/);
  });
});
