export interface ImagesToGifParams {
  /** Time each frame is displayed, in milliseconds. Default 500. */
  frameDelayMs?: number;
  /** Repeat forever when true, or play once when false. Default true. */
  loop?: boolean;
  /** Output width in pixels. Zero uses the first frame's width. Default 0. */
  width?: number;
}

export const defaultImagesToGifParams: ImagesToGifParams = {
  frameDelayMs: 500,
  loop: true,
  width: 0,
};
