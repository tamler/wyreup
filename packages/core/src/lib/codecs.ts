/**
 * Shared codec loader. Lazy-imports jSquash codecs on demand and memoizes
 * them for the session. Used by compress, convert, image-to-pdf, and any
 * tool that needs to encode or decode image bitmaps.
 *
 * Codecs are loaded only when actually needed (inside a tool's run()),
 * keeping initial bundle size minimal.
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface Codec {
  /** Decode a compressed image buffer into an ImageData-like structure. */
  decode(buffer: ArrayBuffer | Uint8Array): Promise<{
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }>;
  /** Encode an ImageData-like structure into a compressed format-specific buffer. */
  encode(
    image: { data: Uint8ClampedArray; width: number; height: number },
    options?: Record<string, unknown>,
  ): Promise<ArrayBuffer>;
}

/**
 * Detect the jSquash-supported format from a MIME type.
 * Returns null for unsupported types so callers can surface a clear error.
 */
export function detectFormat(mime: string): ImageFormat | null {
  const normalized = mime.toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpeg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  return null;
}

const codecCache = new Map<ImageFormat, Codec>();

/**
 * Load a codec for the given format. Dynamic import so the WASM blob is
 * fetched/loaded only when the codec is actually used. Memoized per session.
 */
export async function getCodec(format: ImageFormat): Promise<Codec> {
  const cached = codecCache.get(format);
  if (cached) return cached;

  let codec: Codec;
  switch (format) {
    case 'jpeg': {
      const mod = await import('@jsquash/jpeg');
      codec = { decode: mod.decode, encode: mod.encode };
      break;
    }
    case 'png': {
      const mod = await import('@jsquash/png');
      codec = { decode: mod.decode, encode: mod.encode };
      break;
    }
    case 'webp': {
      const mod = await import('@jsquash/webp');
      codec = { decode: mod.decode, encode: mod.encode };
      break;
    }
  }

  codecCache.set(format, codec);
  return codec;
}
