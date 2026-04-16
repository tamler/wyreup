export interface ImageDiffParams {
  /** Pixel threshold, 0-1. Default 0.1. Higher = more tolerance. */
  threshold?: number;
  /** Color of diff highlights as [r, g, b] tuple. Default [255, 0, 0]. */
  diffColor?: [number, number, number];
}

export interface ImageDiffResult {
  pixelsDifferent: number;
  totalPixels: number;
  percentDifferent: number;
}

export const defaultImageDiffParams: ImageDiffParams = {
  threshold: 0.1,
  diffColor: [255, 0, 0],
};
