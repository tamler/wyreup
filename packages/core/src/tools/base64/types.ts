export interface Base64Params {
  /** 'encode' reads any file and outputs base64 text; 'decode' reads base64 text and outputs bytes. */
  mode: 'encode' | 'decode';
  /** URL-safe variant replaces +/ with -_ and omits padding (RFC 4648 §5). */
  urlSafe?: boolean;
}

export const defaultBase64Params: Base64Params = {
  mode: 'encode',
  urlSafe: false,
};
