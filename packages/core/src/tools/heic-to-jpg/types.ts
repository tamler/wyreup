export interface HeicToJpgParams {
  /** Output format. */
  format?: 'jpeg' | 'png' | 'webp';
  /** Encode quality 1-100 (jpeg/webp). */
  quality?: number;
}

export const defaultHeicToJpgParams: HeicToJpgParams = {
  format: 'jpeg',
  quality: 90,
};
