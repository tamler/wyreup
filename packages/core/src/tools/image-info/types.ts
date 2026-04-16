// image-info takes no params
export type ImageInfoParams = Record<string, never>;

export const defaultImageInfoParams: ImageInfoParams = {};

export interface ImageInfoResult {
  format: 'jpeg' | 'png' | 'webp';
  mimeType: string;
  width: number;
  height: number;
  aspectRatio: string;
  bytes: number;
  megapixels: number;
}
