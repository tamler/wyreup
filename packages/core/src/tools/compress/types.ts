import type { ImageFormat } from '../../lib/codecs.js';

export interface CompressParams {
  /** Output quality, 1-100. Default 80. Only meaningful for JPEG/WebP. */
  quality: number;
  /**
   * Output format. If undefined, preserves the input format.
   * Set explicitly to re-encode as a different format (e.g. JPEG → WebP).
   */
  targetFormat?: ImageFormat;
}

export const defaultCompressParams: CompressParams = {
  quality: 80,
};
