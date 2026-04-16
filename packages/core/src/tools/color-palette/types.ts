export interface ColorPaletteParams {
  /** Number of top colors to extract by population. Default 5. */
  count?: number;
}

export interface ColorPaletteResult {
  vibrant: string | null;
  muted: string | null;
  darkVibrant: string | null;
  darkMuted: string | null;
  lightVibrant: string | null;
  lightMuted: string | null;
  /** Top N colors by population as hex strings. */
  topColors: string[];
}

export const defaultColorPaletteParams: ColorPaletteParams = {
  count: 5,
};
