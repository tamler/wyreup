import { describe, it, expect } from 'vitest';
import { crop } from '../../../src/tools/crop/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';
import { getCodec } from '../../../src/lib/codecs.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('crop — metadata', () => {
  it('has id crop', () => {
    expect(crop.id).toBe('crop');
  });

  it('is in the edit category', () => {
    expect(crop.category).toBe('edit');
  });

  it('accepts jpeg, png, webp', () => {
    expect(crop.input.accept).toContain('image/jpeg');
    expect(crop.input.accept).toContain('image/png');
    expect(crop.input.accept).toContain('image/webp');
  });

  it('allows only 1 input', () => {
    expect(crop.input.min).toBe(1);
    expect(crop.input.max).toBe(1);
  });
});

describe('crop — run()', () => {
  it('crops a region from photo.jpg and returns correct dimensions', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const params = { x: 10, y: 10, width: 100, height: 80 };
    const output = await crop.run([input], params, makeCtx()) as Blob;
    expect(output.type).toBe('image/jpeg');
    expect(output.size).toBeGreaterThan(0);

    const codec = await getCodec('jpeg');
    const buf = await output.arrayBuffer();
    const { width, height } = await codec.decode(buf);
    expect(width).toBe(100);
    expect(height).toBe(80);
  });

  it('crops a region from graphic.png and returns correct dimensions', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const params = { x: 0, y: 0, width: 50, height: 50 };
    const output = await crop.run([input], params, makeCtx()) as Blob;
    expect(output.type).toBe('image/png');

    const codec = await getCodec('png');
    const buf = await output.arrayBuffer();
    const { width, height } = await codec.decode(buf);
    expect(width).toBe(50);
    expect(height).toBe(50);
  });

  it('throws for out-of-bounds crop', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    // photo.jpg is unlikely to be 99999x99999
    const params = { x: 0, y: 0, width: 99999, height: 99999 };
    await expect(crop.run([input], params, makeCtx())).rejects.toThrow(/exceeds source dimensions/i);
  });

  it('throws for negative offset', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    await expect(
      crop.run([input], { x: -1, y: 0, width: 10, height: 10 }, makeCtx()),
    ).rejects.toThrow(/non-negative/i);
  });

  it('throws for zero-size crop', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    await expect(
      crop.run([input], { x: 0, y: 0, width: 0, height: 10 }, makeCtx()),
    ).rejects.toThrow(/positive/i);
  });
});
