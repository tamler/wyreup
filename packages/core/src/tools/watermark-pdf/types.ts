export interface WatermarkPdfParams {
  /** 'text' or 'image'. Default 'text'. */
  mode: 'text' | 'image';
  /** Text to stamp when mode is 'text'. Required for text mode. */
  text?: string;
  /** ArrayBuffer for the image when mode is 'image'. Required for image mode. */
  imageBuffer?: ArrayBuffer;
  /** Image MIME type when mode is 'image'. */
  imageMime?: 'image/jpeg' | 'image/png';
  /** Opacity, 0-1. Default 0.3. */
  opacity?: number;
  /** Font size in points when mode is 'text'. Default 48. */
  fontSize?: number;
  /** Rotation in degrees. Default -45. */
  rotation?: number;
  /** Color as CSS hex string. Default '#888888' for text. */
  color?: string;
}

export const defaultWatermarkPdfParams: WatermarkPdfParams = {
  mode: 'text',
  text: 'CONFIDENTIAL',
  opacity: 0.3,
  fontSize: 48,
  rotation: -45,
  color: '#888888',
};
