import { describe, expect, it } from 'vitest';
import { pickSmaller } from '../../src/lib/pick-smaller.js';

describe('pickSmaller', () => {
  it('keeps an ArrayBuffer original when the encoded payload is equal-sized', () => {
    const original = { bytes: new ArrayBuffer(4), mime: 'image/png' };
    const encoded = { bytes: new Uint8Array(4), mime: 'image/jpeg' };

    const result = pickSmaller(original, encoded);

    expect(result.bytes).toBe(original.bytes);
    expect(result.mime).toBe('image/png');
    expect(result.keptOriginal).toBe(true);
  });

  it('keeps a Uint8Array original when the encoded payload is larger', () => {
    const original = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/webp' };
    const encoded = { bytes: new ArrayBuffer(4), mime: 'image/jpeg' };

    const result = pickSmaller(original, encoded);

    expect(result.bytes).toBe(original.bytes);
    expect(result.mime).toBe('image/webp');
    expect(result.keptOriginal).toBe(true);
  });

  it('returns the encoded payload when it is strictly smaller', () => {
    const original = { bytes: new Uint8Array(5), mime: 'image/png' };
    const encoded = { bytes: new Uint8Array(4), mime: 'image/jpeg' };

    const result = pickSmaller(original, encoded);

    expect(result.bytes).toBe(encoded.bytes);
    expect(result.mime).toBe('image/jpeg');
    expect(result.keptOriginal).toBe(false);
  });
});
