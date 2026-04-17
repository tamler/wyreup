export interface SvgToPngParams {
  /** Scale factor. Default 1. 2 = double resolution (retina). */
  scale?: number;
  /** Background color (CSS). Default transparent (no background). */
  background?: string;
}

export const defaultSvgToPngParams: SvgToPngParams = {
  scale: 1,
};
