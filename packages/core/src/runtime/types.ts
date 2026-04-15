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
   * Wave 0: placeholder that throws NotImplementedError.
   */
  createCanvas(width: number, height: number): unknown;

  /**
   * Decode a Blob into an ImageBitmap-compatible structure. In browsers,
   * this uses `createImageBitmap()`. In Node, this uses the canvas library's
   * image loading. Wave 0: placeholder.
   */
  createImageFromBlob(blob: Blob): Promise<unknown>;
}

/**
 * Default adapter that always reports unavailable. Wave 0 uses this as a
 * placeholder. Wave 1 replaces it with proper browser.ts and node.ts
 * implementations wired via conditional exports.
 */
class PlaceholderAdapter implements RuntimeAdapter {
  isAvailable(): boolean {
    return false;
  }

  createCanvas(_width: number, _height: number): unknown {
    throw new Error('Runtime adapter not implemented in Wave 0');
  }

  createImageFromBlob(_blob: Blob): Promise<unknown> {
    throw new Error('Runtime adapter not implemented in Wave 0');
  }
}

/**
 * Get the current runtime adapter. Wave 0 returns a placeholder that
 * reports unavailable. Wave 1 will wire proper browser/node implementations
 * via conditional exports in package.json.
 */
export function getRuntimeAdapter(): RuntimeAdapter {
  return new PlaceholderAdapter();
}
