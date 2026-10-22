export interface Base64Params {
  /** 'encode' reads any file and outputs base64 text; 'decode' reads base64 text and outputs bytes. */
  mode: 'encode' | 'decode';
  /** URL-safe variant replaces +/ with -_ and omits padding (RFC 4648 §5). */
  urlSafe?: boolean;
  /** Image wrappers use signature-derived MIME and the standard padded Base64 alphabet. */
  encodeOutput?: 'raw' | 'data-url' | 'css-url';
}

export const defaultBase64Params: Base64Params = {
  mode: 'encode',
  urlSafe: false,
  encodeOutput: 'raw',
};
