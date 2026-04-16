import { describe, it, expect } from 'vitest';
import { flipImage } from '../../../src/tools/flip-image/index.js';
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

describe('flip-image — metadata', () => {
  it('has id flip-image', () => {
    expect(flipImage.id).toBe('flip-image');
  });

  it('is in the edit category', () => {
    expect(flipImage.category).toBe('edit');
  });

  it('accepts image/*', () => {
    expect(flipImage.input.accept).toContain('image/*');
  });

  it('defaults to horizontal', () => {
    expect(flipImage.defaults.direction).toBe('horizontal');
  });
});

describe('flip-image — run()', () => {
  it('flips a JPEG horizontally and preserves dimensions', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const codec = await getCodec('jpeg');
    const origBuf = await input.arrayBuffer();
    const { width: origW, height: origH } = await codec.decode(origBuf);

    const outputs = await flipImage.run([input], { direction: 'horizontal' }, makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');

    const flipBuf = await outputs[0]!.arrayBuffer();
    const { width: newW, height: newH } = await codec.decode(flipBuf);
    expect(newW).toBe(origW);
    expect(newH).toBe(origH);
  });

  it('flips a PNG vertically and preserves dimensions', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const codec = await getCodec('png');
    const origBuf = await input.arrayBuffer();
    const { width: origW, height: origH } = await codec.decode(origBuf);

    const outputs = await flipImage.run([input], { direction: 'vertical' }, makeCtx());
    expect(outputs[0]!.type).toBe('image/png');

    const flipBuf = await outputs[0]!.arrayBuffer();
    const { width: newW, height: newH } = await codec.decode(flipBuf);
    expect(newW).toBe(origW);
    expect(newH).toBe(origH);
  });

  it('produces different pixel data when flipped horizontally', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const codec = await getCodec('jpeg');
    const origBuf = await input.arrayBuffer();
    const orig = await codec.decode(origBuf);

    const outputs = await flipImage.run([input], { direction: 'horizontal' }, makeCtx());
    const flipBuf = await outputs[0]!.arrayBuffer();
    const flipped = await codec.decode(flipBuf);

    // The first pixel of the original should match the last pixel in the same row of the flipped
    const lastPixelOrigRow0 = (orig.width - 1) * 4;
    // Due to lossy re-encoding we just check the image is non-zero
    expect(flipped.data.length).toBe(orig.data.length);
    expect(flipped.data[0]).toBeDefined();
    // The last pixel of row 0 in original should approximately match first pixel of row 0 in flipped
    expect(Math.abs((flipped.data[0] ?? 0) - (orig.data[lastPixelOrigRow0] ?? 0))).toBeLessThan(20);
  });

  it('throws for unsupported format', async () => {
    const fakePdf = new File(['%PDF'], 'x.pdf', { type: 'application/pdf' });
    await expect(
      flipImage.run([fakePdf], { direction: 'horizontal' }, makeCtx()),
    ).rejects.toThrow(/unsupported/i);
  });
});
