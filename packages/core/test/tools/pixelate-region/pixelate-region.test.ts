import { describe, it, expect } from 'vitest';
import { pixelateRegion } from '../../../src/tools/pixelate-region/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { getCodec } from '../../../src/lib/codecs.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('pixelate-region — metadata', () => {
  it('declares privacy and edit categories', () => {
    expect(pixelateRegion.id).toBe('pixelate-region');
    expect(pixelateRegion.slug).toBe('pixelate-region');
    expect(pixelateRegion.category).toBe('privacy');
    expect(pixelateRegion.categories).toContain('edit');
    expect(pixelateRegion.cost).toBe('free');
  });
});

describe('pixelate-region — run()', () => {
  it('changes pixels in the selected region and leaves outside pixels identical', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const codec = await getCodec('png');
    const source = await codec.decode(await input.arrayBuffer());
    const outputs = (await pixelateRegion.run(
      [input],
      { x: 80, y: 80, width: 160, height: 160, blockSize: 16 },
      makeCtx(),
    )) as Blob[];
    const output = outputs[0]!;
    const result = await codec.decode(await output.arrayBuffer());
    let changedInside = 0;
    let changedOutside = 0;

    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const offset = (y * source.width + x) * 4;
        const sourcePixel = source.data.slice(offset, offset + 4);
        const resultPixel = result.data.slice(offset, offset + 4);
        if (x >= 80 && x < 240 && y >= 80 && y < 240) {
          if (!sourcePixel.every((value, channel) => value === resultPixel[channel])) {
            changedInside++;
          }
        } else if (!sourcePixel.every((value, channel) => value === resultPixel[channel])) {
          changedOutside++;
        }
      }
    }

    expect(changedInside).toBeGreaterThan(0);
    expect(changedOutside).toBe(0);
  });

  it('pixelates the entire image when width and height are zero', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const codec = await getCodec('png');
    const source = await codec.decode(await input.arrayBuffer());
    const outputs = (await pixelateRegion.run(
      [input],
      { x: 100, y: 100, width: 0, height: 0, blockSize: 32 },
      makeCtx(),
    )) as Blob[];
    const output = outputs[0]!;
    const result = await codec.decode(await output.arrayBuffer());
    let nonUniformPixels = 0;
    let changedPixels = 0;

    for (let blockY = 0; blockY < result.height; blockY += 32) {
      for (let blockX = 0; blockX < result.width; blockX += 32) {
        const firstOffset = (blockY * result.width + blockX) * 4;
        const expected = result.data.slice(firstOffset, firstOffset + 4);
        const blockBottom = Math.min(blockY + 32, result.height);
        const blockRight = Math.min(blockX + 32, result.width);
        for (let y = blockY; y < blockBottom; y++) {
          for (let x = blockX; x < blockRight; x++) {
            const offset = (y * result.width + x) * 4;
            const pixel = result.data.slice(offset, offset + 4);
            if (!expected.every((value, channel) => value === pixel[channel])) {
              nonUniformPixels++;
            }
            const sourcePixel = source.data.slice(offset, offset + 4);
            if (!sourcePixel.every((value, channel) => value === pixel[channel])) {
              changedPixels++;
            }
          }
        }
      }
    }

    expect(nonUniformPixels).toBe(0);
    expect(changedPixels).toBeGreaterThan(0);
  });

  it('clamps a region that extends beyond the image bounds', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const beyondBounds = (await pixelateRegion.run(
      [input],
      { x: 360, y: 360, width: 100, height: 100, blockSize: 16 },
      makeCtx(),
    )) as Blob[];
    const exactBounds = (await pixelateRegion.run(
      [input],
      { x: 360, y: 360, width: 40, height: 40, blockSize: 16 },
      makeCtx(),
    )) as Blob[];

    expect(new Uint8Array(await beyondBounds[0]!.arrayBuffer())).toEqual(
      new Uint8Array(await exactBounds[0]!.arrayBuffer()),
    );
  });

  it('preserves the source image format', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = (await pixelateRegion.run(
      [input],
      { x: 0, y: 0, width: 32, height: 32, blockSize: 8 },
      makeCtx(),
    )) as Blob[];
    const output = outputs[0]!;

    expect(output.type).toBe('image/jpeg');
    const codec = await getCodec('jpeg');
    const decoded = await codec.decode(await output.arrayBuffer());
    expect(decoded.width).toBeGreaterThan(0);
    expect(decoded.height).toBeGreaterThan(0);
  });
});
