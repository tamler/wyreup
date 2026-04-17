export interface FaviconParams {
  /** Sizes to generate as PNGs. Default [16, 32, 48, 64, 128, 180, 192, 512]. */
  sizes?: number[];
  /** Include an ICO containing the 16/32/48 sizes. Default true. */
  includeIco?: boolean;
}

export const defaultFaviconParams: FaviconParams = {
  sizes: [16, 32, 48, 64, 128, 180, 192, 512],
  includeIco: true,
};
