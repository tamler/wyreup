import type { RuntimeAdapter } from './types.js';
import { createCanvas, loadImage } from '../lib/canvas.js';

export const browserAdapter: RuntimeAdapter = {
  isAvailable(): boolean {
    return (
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas !==
        'undefined'
    );
  },
  createCanvas(width: number, height: number): Promise<unknown> {
    return createCanvas(width, height);
  },
  createImageFromBlob(blob: Blob): Promise<unknown> {
    return loadImage(blob);
  },
};
