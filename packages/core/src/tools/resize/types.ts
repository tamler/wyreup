export interface ResizeParams {
  /** 'exact' uses width+height directly, 'fit' scales to fit within box (preserves aspect), 'percent' scales by factor. */
  mode: 'exact' | 'fit' | 'percent';
  width?: number;
  height?: number;
  /** 1-1000, required for percent mode (e.g. 50 for half size). */
  percent?: number;
  /** For jpeg/webp output. Default 90. */
  quality?: number;
}

export const defaultResizeParams: ResizeParams = {
  mode: 'fit',
  width: 1920,
  height: 1080,
  quality: 90,
};
