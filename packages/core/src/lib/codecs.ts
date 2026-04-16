/**
 * Shared codec loader. Lazy-imports jSquash codecs on demand and memoizes
 * them for the session. Used by compress, convert, image-to-pdf, and any
 * tool that needs to encode or decode image bitmaps.
 *
 * Codecs are loaded only when actually needed (inside a tool's run()),
 * keeping initial bundle size minimal.
 *
 * Node/WASM note: jSquash's default auto-init uses fetch() which fails in
 * Node. When running in Node, we read each .wasm file from disk and compile
 * it manually before importing the codec, then pass the compiled module to
 * the codec's init() function so it skips the fetch path.
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

/** True when running in Node (vs browser / service worker). */
function isNode(): boolean {
  return (
    typeof process === 'object' &&
    process.release != null &&
    process.release.name === 'node'
  );
}

/**
 * In Node, read a .wasm file from disk and compile it into a WebAssembly.Module.
 * This compiled module can be passed to jSquash init() to bypass fetch().
 * Returns undefined in browser environments (auto-init handles it there).
 *
 * Uses createRequire to resolve the package-relative .wasm path within
 * node_modules — this works in both raw Node and Vitest's SSR transform,
 * unlike import.meta.resolve which Vite does not implement.
 */
async function compileWasm(
  packageSpecifier: string,
): Promise<WebAssembly.Module | undefined> {
  if (!isNode()) return undefined;
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const wasmPath: string = require.resolve(packageSpecifier);
  const bytes = readFileSync(wasmPath);
  return WebAssembly.compile(bytes);
}

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
      const [decMod, encMod] = await Promise.all([
        import('@jsquash/jpeg/decode.js'),
        import('@jsquash/jpeg/encode.js'),
      ]);
      const [decWasm, encWasm] = await Promise.all([
        compileWasm('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'),
        compileWasm('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'),
      ]);
      await Promise.all([
        decMod.init(decWasm as WebAssembly.Module),
        encMod.init(encWasm as WebAssembly.Module),
      ]);
      codec = { decode: decMod.default, encode: encMod.default };
      break;
    }
    case 'png': {
      const [decMod, encMod] = await Promise.all([
        import('@jsquash/png/decode.js'),
        import('@jsquash/png/encode.js'),
      ]);
      // PNG dec and enc share the same wasm module.
      const pngWasm = await compileWasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm');
      // PNG init takes a wasm module or path; pass the compiled module in Node.
      await Promise.all([
        decMod.init(pngWasm),
        encMod.init(pngWasm),
      ]);
      codec = { decode: decMod.default, encode: encMod.default };
      break;
    }
    case 'webp': {
      const [decMod, encMod] = await Promise.all([
        import('@jsquash/webp/decode.js'),
        import('@jsquash/webp/encode.js'),
      ]);
      const [decWasm, encWasm] = await Promise.all([
        compileWasm('@jsquash/webp/codec/dec/webp_dec.wasm'),
        // Use the non-SIMD encoder for reliable Node compat; SIMD init is
        // done automatically in the browser via wasm-feature-detect.
        compileWasm('@jsquash/webp/codec/enc/webp_enc.wasm'),
      ]);
      await Promise.all([
        decMod.init(decWasm as WebAssembly.Module),
        encMod.init(encWasm as WebAssembly.Module),
      ]);
      codec = { decode: decMod.default, encode: encMod.default };
      break;
    }
  }

  codecCache.set(format, codec);
  return codec;
}
