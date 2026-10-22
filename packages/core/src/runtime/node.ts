import type { RuntimeAdapter } from './types.js';
import { createCanvas, loadImage } from '../lib/canvas.js';

export const nodeAdapter: RuntimeAdapter = {
  isAvailable(): boolean {
    return typeof process !== 'undefined' && typeof process.versions?.node === 'string';
  },
  createCanvas(width: number, height: number): Promise<unknown> {
    return createCanvas(width, height);
  },
  createImageFromBlob(blob: Blob): Promise<unknown> {
    return loadImage(blob);
  },
};
