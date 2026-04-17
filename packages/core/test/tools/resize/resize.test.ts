import { describe, it, expect } from 'vitest';
import { resize } from '../../../src/tools/resize/index.js';
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

describe('resize — metadata', () => {
  it('has id resize', () => {
    expect(resize.id).toBe('resize');
  });

  it('is in the edit category', () => {
    expect(resize.category).toBe('edit');
  });

  it('accepts jpeg, png, webp', () => {
    expect(resize.input.accept).toContain('image/jpeg');
    expect(resize.input.accept).toContain('image/png');
    expect(resize.input.accept).toContain('image/webp');
  });
});

describe('resize — run()', () => {
  it('resizes exact to 400x300', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const outputs = await resize.run([input], { mode: 'exact', width: 400, height: 300 }, makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');

    const codec = await getCodec('jpeg');
    const buf = await outputs[0]!.arrayBuffer();
    const { width, height } = await codec.decode(buf);
    expect(width).toBe(400);
    expect(height).toBe(300);
  });

  it('fit mode preserves aspect ratio', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    // Get source dimensions first
    const codec = await getCodec('jpeg');
    const srcBuf = await input.arrayBuffer();
    const { width: srcW, height: srcH } = await codec.decode(srcBuf);

    const outputs = await resize.run([input], { mode: 'fit', width: 200, height: 200 }, makeCtx());
    const buf = await outputs[0]!.arrayBuffer();
    const { width, height } = await codec.decode(buf);

    // Output must fit within 200x200
    expect(width).toBeLessThanOrEqual(200);
    expect(height).toBeLessThanOrEqual(200);

    // Aspect ratio preserved within 1%
    const srcAspect = srcW / srcH;
    const outAspect = width / height;
    expect(Math.abs(srcAspect - outAspect)).toBeLessThan(0.02);
  });

  it('percent 50 approximately halves dimensions', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const codec = await getCodec('png');
    const srcBuf = await input.arrayBuffer();
    const { width: srcW, height: srcH } = await codec.decode(srcBuf);

    const outputs = await resize.run([input], { mode: 'percent', percent: 50 }, makeCtx());
    const buf = await outputs[0]!.arrayBuffer();
    const { width, height } = await codec.decode(buf);

    expect(width).toBe(Math.round(srcW / 2));
    expect(height).toBe(Math.round(srcH / 2));
  });

  it('throws when width/height missing for exact mode', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    await expect(
      resize.run([input], { mode: 'exact' }, makeCtx()),
    ).rejects.toThrow(/width and height/i);
  });

  it('throws when percent missing for percent mode', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    await expect(
      resize.run([input], { mode: 'percent' }, makeCtx()),
    ).rejects.toThrow(/percent param/i);
  });
});
