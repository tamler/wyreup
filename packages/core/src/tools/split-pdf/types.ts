export interface SplitPdfParams {
  /**
   * How to split. 'all' = one PDF per page. 'ranges' = parse the ranges string
   * like "1-3,5,7-9" into separate PDFs.
   */
  mode: 'all' | 'ranges';
  /** Comma-separated page ranges when mode is 'ranges'. 1-indexed inclusive. */
  ranges?: string;
}

export const defaultSplitPdfParams: SplitPdfParams = {
  mode: 'all',
};
