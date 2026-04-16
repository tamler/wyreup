import type { ImageFormat } from '../../lib/codecs.js';

export interface ConvertParams {
  /** Target format. Required. */
  targetFormat: ImageFormat;
  /** Output quality, 1-100. Only meaningful for jpeg/webp. Default 90. */
  quality?: number;
}

export const defaultConvertParams: ConvertParams = {
  targetFormat: 'webp',
  quality: 90,
};
