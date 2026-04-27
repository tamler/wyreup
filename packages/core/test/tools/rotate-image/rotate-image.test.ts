import { describe, it, expect } from 'vitest';
import { rotateImage } from '../../../src/tools/rotate-image/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';
import { detectFormat, getCodec } from '../../../src/lib/codecs.js';
import { composeOrientation, decodeJpegOrientation } from '../../../src/lib/exif.js';

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
  it('rotates a JPEG by 90° via EXIF orientation (lossless)', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const origBuf = await input.arrayBuffer();
    const origOrientation = decodeJpegOrientation(origBuf);

    const outputs = (await rotateImage.run([input], { degrees: 90 }, makeCtx())) as Blob[];
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');

    const rotBuf = await outputs[0]!.arrayBuffer();
    const rotOrientation = decodeJpegOrientation(rotBuf);
    expect(rotOrientation).toBe(composeOrientation(origOrientation, 90));

    // Lossless: bytes are preserved. The only change is either a 2-byte
    // in-place EXIF orientation overwrite (size unchanged) or a 36-byte
    // injected EXIF segment for JPEGs without one.
    const sizeDiff = Math.abs(rotBuf.byteLength - origBuf.byteLength);
    expect(sizeDiff === 0 || sizeDiff === 36).toBe(true);
  });

  it('rotates a PNG by 180° and preserves dimensions', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const codec = await getCodec('png');
    const origBuf = await input.arrayBuffer();
    const { width: origW, height: origH } = await codec.decode(origBuf);

    const outputs = (await rotateImage.run([input], { degrees: 180 }, makeCtx())) as Blob[];
    expect(outputs[0]!.type).toBe('image/png');

    const rotBuf = await outputs[0]!.arrayBuffer();
    const { width: newW, height: newH } = await codec.decode(rotBuf);
    expect(newW).toBe(origW);
    expect(newH).toBe(origH);
  });

  it('rotates a JPEG by 270° via EXIF orientation', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const origBuf = await input.arrayBuffer();
    const origOrientation = decodeJpegOrientation(origBuf);

    const outputs = (await rotateImage.run([input], { degrees: 270 }, makeCtx())) as Blob[];
    const rotBuf = await outputs[0]!.arrayBuffer();
    const rotOrientation = decodeJpegOrientation(rotBuf);
    expect(rotOrientation).toBe(composeOrientation(origOrientation, 270));
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
