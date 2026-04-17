export interface ImageWatermarkParams {
  text: string;
  /** Corner position. Default 'bottom-right'. */
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  /** CSS hex color. Default '#FFFFFF'. */
  color?: string;
  /** Opacity 0-1. Default 0.5. */
  opacity?: number;
  /** Font size in px. Default 32. */
  fontSize?: number;
  /** Margin from edge in px. Default 20. */
  margin?: number;
  /** For jpeg/webp output. Default 90. */
  quality?: number;
}

export const defaultImageWatermarkParams: ImageWatermarkParams = {
  text: '',
  position: 'bottom-right',
  color: '#FFFFFF',
  opacity: 0.5,
  fontSize: 32,
  margin: 20,
  quality: 90,
};
