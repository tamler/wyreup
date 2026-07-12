import type { ImageFormat } from '../../lib/codecs.js';

export type ImageCollageLayout = 'horizontal' | 'vertical' | 'grid';

export interface ImageCollageParams {
  /** Arrangement of images in the collage. Default grid. */
  layout: ImageCollageLayout;
  /** Number of columns for grid layout, 1-6. Default 2. */
  columns: number;
  /** Space between cells in pixels, 0-64. Default 8. */
  spacing: number;
  /** Background color as #rgb or #rrggbb. Default #ffffff. */
  background: string;
  /** Output image format. Default jpeg. */
  format: ImageFormat;
  /** Output quality, 1-100. Default 90. Only meaningful for JPEG/WebP. */
  quality: number;
}

export const defaultImageCollageParams: ImageCollageParams = {
  layout: 'grid',
  columns: 2,
  spacing: 8,
  background: '#ffffff',
  format: 'jpeg',
  quality: 90,
};
