export interface PixelateRegionParams {
  /** Rectangle x coordinate in pixels. Default 0. */
  x: number;
  /** Rectangle y coordinate in pixels. Default 0. */
  y: number;
  /** Rectangle width in pixels. Default 0, which pixelates the entire image. */
  width: number;
  /** Rectangle height in pixels. Default 0, which pixelates the entire image. */
  height: number;
  /** Pixel block size, 4-128. Default 16. */
  blockSize: number;
}

export const defaultPixelateRegionParams: PixelateRegionParams = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  blockSize: 16,
};
