import { describe, it, expect } from 'vitest';
import { imageWatermark } from '../../../src/tools/image-watermark/index.js';
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

describe('image-watermark — metadata', () => {
  it('has id image-watermark', () => {
    expect(imageWatermark.id).toBe('image-watermark');
  });

  it('is in the edit category', () => {
    expect(imageWatermark.category).toBe('edit');
  });

  it('accepts jpeg, png, webp', () => {
    expect(imageWatermark.input.accept).toContain('image/jpeg');
    expect(imageWatermark.input.accept).toContain('image/png');
    expect(imageWatermark.input.accept).toContain('image/webp');
  });
});

describe('image-watermark — run()', () => {
  it('adds watermark to JPEG and preserves dimensions', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const codec = await getCodec('jpeg');
    const srcBuf = await input.arrayBuffer();
    const { width: srcW, height: srcH } = await codec.decode(srcBuf);

    const outputs = await imageWatermark.run(
      [input],
      { text: 'Test Watermark', position: 'bottom-right' },
      makeCtx(),
    );
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');

    const buf = await outputs[0]!.arrayBuffer();
    const { width, height } = await codec.decode(buf);
    expect(width).toBe(srcW);
    expect(height).toBe(srcH);
  });

  it('watermarks a PNG image', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const outputs = await imageWatermark.run(
      [input],
      { text: 'Copyright', position: 'top-left', color: '#000000', opacity: 0.8 },
      makeCtx(),
    );
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/png');
    expect(outputs[0]!.size).toBeGreaterThan(0);
  });

  it('throws on empty text param', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    await expect(
      imageWatermark.run([input], { text: '', position: 'center' }, makeCtx()),
    ).rejects.toThrow(/text param/i);
  });

  it('throws on whitespace-only text param', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    await expect(
      imageWatermark.run([input], { text: '   ', position: 'center' }, makeCtx()),
    ).rejects.toThrow(/text param/i);
  });
});
