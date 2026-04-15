// Node runtime adapter. Wave 0 placeholder; populated in Wave 1 using
// @napi-rs/canvas for canvas operations. Consumed via conditional exports
// when the package is imported in a Node context.

import type { RuntimeAdapter } from './types.js';

export const nodeAdapter: RuntimeAdapter = {
  isAvailable(): boolean {
    return typeof process !== 'undefined' && typeof process.versions?.node === 'string';
  },
  createCanvas(_width: number, _height: number): unknown {
    throw new Error('nodeAdapter.createCanvas: Wave 1 implementation pending (will use @napi-rs/canvas)');
  },
  createImageFromBlob(_blob: Blob): Promise<unknown> {
    throw new Error('nodeAdapter.createImageFromBlob: Wave 1 implementation pending');
  },
};
