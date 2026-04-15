// Browser runtime adapter. Wave 0 placeholder; populated in Wave 1.
// Consumed via conditional exports when the package is imported in a browser context.

import type { RuntimeAdapter } from './types.js';

export const browserAdapter: RuntimeAdapter = {
  isAvailable(): boolean {
    return (
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas !== 'undefined'
    );
  },
  createCanvas(_width: number, _height: number): unknown {
    throw new Error('browserAdapter.createCanvas: Wave 1 implementation pending');
  },
  createImageFromBlob(_blob: Blob): Promise<unknown> {
    throw new Error('browserAdapter.createImageFromBlob: Wave 1 implementation pending');
  },
};
