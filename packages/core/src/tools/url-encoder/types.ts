export interface UrlEncoderParams {
  mode: 'encode' | 'decode';
  /** 'component' uses encodeURIComponent; 'full' uses encodeURI. Default 'component'. */
  scope?: 'component' | 'full';
}

export const defaultUrlEncoderParams: UrlEncoderParams = {
  mode: 'encode',
  scope: 'component',
};
