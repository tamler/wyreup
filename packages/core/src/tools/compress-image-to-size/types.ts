export interface CompressImageToSizeParams {
  /** Target file size in kilobytes. */
  targetKb?: number;
  /** Allow shrinking dimensions when quality reduction alone can't reach the target. */
  allowDownscale?: boolean;
}

export const defaultCompressImageToSizeParams: CompressImageToSizeParams = {
  targetKb: 200,
  allowDownscale: true,
};
