// No params — converts timestamp to all formats at once.
export type TimestampConverterParams = Record<string, never>;

export const defaultTimestampConverterParams: TimestampConverterParams = {};

export interface TimestampConverterResult {
  input: string;
  valid: boolean;
  epochSeconds: number | null;
  epochMilliseconds: number | null;
  iso8601: string | null;
  utc: string | null;
  local: string | null;
  relative: string | null;
}
