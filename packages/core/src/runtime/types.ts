/**
 * Runtime adapter interface. Bridges between browser and node implementations
 * of canvas, image decoding, and related platform APIs that tools depend on.
 *
 * Tools import `getRuntimeAdapter()` and call its methods, staying agnostic
 * to which runtime they're in. The adapter is resolved at build time via
 * conditional exports in package.json (browser vs node).
 */
export interface RuntimeAdapter {
  /** Whether this runtime is actually usable (has required APIs). */
  isAvailable(): boolean;

  /**
   * Create an OffscreenCanvas-compatible surface. In browsers, this returns
   * an OffscreenCanvas. In Node, it returns a @napi-rs/canvas equivalent.
   */
  createCanvas(width: number, height: number): Promise<unknown>;

  /**
   * Decode a Blob into an ImageBitmap-compatible structure. In browsers,
   * this uses `createImageBitmap()`. In Node, this uses the canvas library's
   * image loading.
   */
  createImageFromBlob(blob: Blob): Promise<unknown>;
}

/**
 * Runtime-neutral adapter backed by the same lazy canvas helpers the tools use.
 */
class DefaultRuntimeAdapter implements RuntimeAdapter {
  isAvailable(): boolean {
    if (typeof process !== 'undefined' && typeof process.versions?.node === 'string') return true;
    return typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
  }

  createCanvas(width: number, height: number): Promise<unknown> {
    return createCanvasSurface(width, height);
  }

  createImageFromBlob(blob: Blob): Promise<unknown> {
    return loadImage(blob);
  }
}

const defaultRuntimeAdapter = new DefaultRuntimeAdapter();

/**
 * Get the adapter for the active runtime.
 */
export function getRuntimeAdapter(): RuntimeAdapter {
  return defaultRuntimeAdapter;
}
import { createCanvas as createCanvasSurface, loadImage } from '../lib/canvas.js';
