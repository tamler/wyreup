export interface QrParams {
  /** Text or URL to encode. Required. */
  text: string;
  /** Output image size in pixels. Default 300. */
  size?: number;
  /** Foreground color as CSS color string. Default '#000000'. */
  foregroundColor?: string;
  /** Background color as CSS color string. Default '#ffffff'. */
  backgroundColor?: string;
  /** Error correction level. Default 'M'. */
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

export const defaultQrParams: QrParams = {
  text: '',
  size: 300,
  foregroundColor: '#000000',
  backgroundColor: '#ffffff',
  errorCorrectionLevel: 'M',
};
