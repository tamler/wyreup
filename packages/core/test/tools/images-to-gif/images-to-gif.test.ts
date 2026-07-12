import { describe, expect, it } from 'vitest';
import { imagesToGif, normalizeGifFrames } from '../../../src/tools/images-to-gif/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('images-to-gif — metadata', () => {
  it('declares its input, output, and category contract', () => {
    expect(imagesToGif.category).toBe('create');
    expect(imagesToGif.categories).toEqual(['create', 'media']);
    expect(imagesToGif.input.min).toBe(2);
    expect(imagesToGif.input.max).toBe(50);
    expect(imagesToGif.output.mime).toBe('image/gif');
    expect(imagesToGif.cost).toBe('free');
  });

  it('paramSchema covers every defaults key with labels and help', () => {
    for (const key of Object.keys(imagesToGif.defaults)) {
      expect(imagesToGif.paramSchema, key).toHaveProperty(key);
      expect(
        imagesToGif.paramSchema?.[key as keyof typeof imagesToGif.defaults]?.label,
      ).toBeTruthy();
      expect(
        imagesToGif.paramSchema?.[key as keyof typeof imagesToGif.defaults]?.help,
      ).toBeTruthy();
    }
    expect(imagesToGif.defaults).toEqual({ frameDelayMs: 500, loop: true, width: 0 });
  });
});

describe('images-to-gif — frame normalization', () => {
  it('box-averages scaling and centers mismatched frames on opaque black', () => {
    const first = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([0, 0, 0, 255, 100, 0, 0, 255, 0, 100, 0, 255, 100, 100, 0, 255]),
    };
    const wide = {
      width: 4,
      height: 2,
      data: new Uint8ClampedArray([
        200, 0, 0, 255, 200, 0, 0, 255, 200, 0, 0, 255, 200, 0, 0, 255, 200, 0, 0, 255, 200, 0, 0,
        255, 200, 0, 0, 255, 200, 0, 0, 255,
      ]),
    };

    const normalized = normalizeGifFrames([first], 1);
    const letterboxed = normalizeGifFrames([first, wide], 2);

    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({ width: 1, height: 1 });
    expect(Array.from(normalized[0]!.data)).toEqual([50, 50, 0, 255]);
    expect(Array.from(letterboxed[1]!.data.slice(0, 8))).toEqual([200, 0, 0, 255, 200, 0, 0, 255]);
    expect(Array.from(letterboxed[1]!.data.slice(8))).toEqual([0, 0, 0, 255, 0, 0, 0, 255]);
  });

  it('weights partially covered pixels during non-integer box scaling', () => {
    const frame = {
      width: 3,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255, 60, 0, 0, 255, 120, 0, 0, 255]),
    };

    const [normalized] = normalizeGifFrames([frame], 2);

    expect(Array.from(normalized!.data)).toEqual([20, 0, 0, 255, 100, 0, 0, 255]);
  });
});

describe('images-to-gif — run()', () => {
  it('encodes JPEG and PNG fixtures as a non-empty GIF89a animation', async () => {
    const output = (await imagesToGif.run(
      [loadFixture('photo.jpg', 'image/jpeg'), loadFixture('graphic.png', 'image/png')],
      { frameDelayMs: 500, loop: true, width: 0 },
      makeCtx(),
    )) as Blob;
    const signature = new TextDecoder().decode(
      new Uint8Array(await output.arrayBuffer()).slice(0, 6),
    );

    expect(output.type).toBe('image/gif');
    expect(output.size).toBeGreaterThan(0);
    expect(signature).toBe('GIF89a');
  });

  it('throws when fewer than two images are supplied', async () => {
    await expect(
      imagesToGif.run([loadFixture('photo.jpg', 'image/jpeg')], {}, makeCtx()),
    ).rejects.toThrow(/2.*50|two/i);
  });
});
