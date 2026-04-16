import { describe, it, expect } from 'vitest';
import { rotateImage } from '../../../src/tools/rotate-image/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';
import { detectFormat, getCodec } from '../../../src/lib/codecs.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('rotate-image — metadata', () => {
  it('has id rotate-image', () => {
    expect(rotateImage.id).toBe('rotate-image');
  });

  it('is in the edit category', () => {
    expect(rotateImage.category).toBe('edit');
  });

  it('accepts jpeg, png, webp', () => {
    expect(rotateImage.input.accept).toContain('image/jpeg');
    expect(rotateImage.input.accept).toContain('image/png');
    expect(rotateImage.input.accept).toContain('image/webp');
  });

  it('defaults to 90 degrees', () => {
    expect(rotateImage.defaults.degrees).toBe(90);
  });
});

describe('rotate-image — run()', () => {
  it('rotates a JPEG by 90° and swaps dimensions', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const codec = await getCodec('jpeg');
    const origBuf = await input.arrayBuffer();
    const { width: origW, height: origH } = await codec.decode(origBuf);

    const outputs = await rotateImage.run([input], { degrees: 90 }, makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');

    const rotBuf = await outputs[0]!.arrayBuffer();
    const { width: newW, height: newH } = await codec.decode(rotBuf);
    expect(newW).toBe(origH);
    expect(newH).toBe(origW);
  });

  it('rotates a PNG by 180° and preserves dimensions', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const codec = await getCodec('png');
    const origBuf = await input.arrayBuffer();
    const { width: origW, height: origH } = await codec.decode(origBuf);

    const outputs = await rotateImage.run([input], { degrees: 180 }, makeCtx());
    expect(outputs[0]!.type).toBe('image/png');

    const rotBuf = await outputs[0]!.arrayBuffer();
    const { width: newW, height: newH } = await codec.decode(rotBuf);
    expect(newW).toBe(origW);
    expect(newH).toBe(origH);
  });

  it('rotates by 270° and swaps dimensions', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const codec = await getCodec('jpeg');
    const origBuf = await input.arrayBuffer();
    const { width: origW, height: origH } = await codec.decode(origBuf);

    const outputs = await rotateImage.run([input], { degrees: 270 }, makeCtx());
    const rotBuf = await outputs[0]!.arrayBuffer();
    const { width: newW, height: newH } = await codec.decode(rotBuf);
    expect(newW).toBe(origH);
    expect(newH).toBe(origW);
  });

  it('throws for unsupported format', async () => {
    const fakePdf = new File(['%PDF'], 'x.pdf', { type: 'application/pdf' });
    await expect(
      rotateImage.run([fakePdf], { degrees: 90 }, makeCtx()),
    ).rejects.toThrow(/unsupported/i);
  });

  it('detects format correctly via detectFormat', () => {
    expect(detectFormat('image/jpeg')).toBe('jpeg');
    expect(detectFormat('image/png')).toBe('png');
    expect(detectFormat('image/webp')).toBe('webp');
  });
});
