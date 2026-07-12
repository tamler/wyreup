export interface HarSanitizeParams {
  redactCookies?: boolean;
  redactAuthHeaders?: boolean;
  redactQueryTokens?: boolean;
  redactPostData?: boolean;
}

export interface HarSanitizeCounts {
  cookies: number;
  authHeaders: number;
  queryTokens: number;
  postData: number;
}

export const defaultHarSanitizeParams: HarSanitizeParams = {
  redactCookies: true,
  redactAuthHeaders: true,
  redactQueryTokens: true,
  redactPostData: false,
};
