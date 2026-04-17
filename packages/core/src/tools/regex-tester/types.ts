export interface RegexTesterParams {
  /** The regex pattern (without delimiters). Required. */
  pattern: string;
  /** Flags. Default 'g'. */
  flags?: string;
}

export const defaultRegexTesterParams: RegexTesterParams = {
  pattern: '',
  flags: 'g',
};

export interface RegexTesterMatch {
  match: string;
  index: number;
  groups?: Record<string, string>;
}

export interface RegexTesterResult {
  valid: boolean;
  error?: string;
  matchCount: number;
  matches: RegexTesterMatch[];
}
