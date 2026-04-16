// strip-exif takes no user-facing parameters; re-encoding at quality 95
// is an internal detail that naturally drops metadata.
export type StripExifParams = Record<string, never>;

export const defaultStripExifParams: StripExifParams = {};
