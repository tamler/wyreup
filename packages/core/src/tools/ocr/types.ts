export interface OcrParams {
  /** Language code(s). Default 'eng'. Multiple: 'eng+fra'. */
  language?: string;
}

export const defaultOcrParams: OcrParams = {
  language: 'eng',
};
