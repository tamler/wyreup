import { describe, it, expect } from 'vitest';
import { detectFormat, getCodec } from '../../src/lib/codecs.js';

describe('detectFormat', () => {
  it('returns "jpeg" for image/jpeg', () => {
    expect(detectFormat('image/jpeg')).toBe('jpeg');
  });

  it('returns "jpeg" for image/jpg (common alias)', () => {
    expect(detectFormat('image/jpg')).toBe('jpeg');
  });

  it('returns "png" for image/png', () => {
    expect(detectFormat('image/png')).toBe('png');
  });

  it('returns "webp" for image/webp', () => {
    expect(detectFormat('image/webp')).toBe('webp');
  });

  it('returns null for unsupported types', () => {
    expect(detectFormat('application/pdf')).toBeNull();
    expect(detectFormat('image/heic')).toBeNull();
    expect(detectFormat('text/plain')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(detectFormat('IMAGE/JPEG')).toBe('jpeg');
    expect(detectFormat('Image/Png')).toBe('png');
  });
});

describe('getCodec', () => {
  it('returns a codec with decode and encode for jpeg', async () => {
    const codec = await getCodec('jpeg');
    expect(typeof codec.decode).toBe('function');
    expect(typeof codec.encode).toBe('function');
  });

  it('returns a codec with decode and encode for png', async () => {
    const codec = await getCodec('png');
    expect(typeof codec.decode).toBe('function');
    expect(typeof codec.encode).toBe('function');
  });

  it('returns a codec with decode and encode for webp', async () => {
    const codec = await getCodec('webp');
    expect(typeof codec.decode).toBe('function');
    expect(typeof codec.encode).toBe('function');
  });

  it('memoizes codecs across calls (same reference)', async () => {
    const a = await getCodec('jpeg');
    const b = await getCodec('jpeg');
    expect(a).toBe(b);
  });
});
