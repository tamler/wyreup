// No params — converts to all formats at once.
export type ColorConverterParams = Record<string, never>;

export const defaultColorConverterParams: ColorConverterParams = {};

export interface ColorConverterResult {
  input: string;
  hex: string;
  rgb: { r: number; g: number; b: number; a?: number };
  rgbString: string;
  hsl: { h: number; s: number; l: number; a?: number };
  hslString: string;
  oklch: { l: number; c: number; h: number };
  oklchString: string;
  oklab: { l: number; a: number; b: number };
  valid: boolean;
}
