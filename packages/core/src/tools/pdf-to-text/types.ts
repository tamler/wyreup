export interface PdfToTextParams {
  /**
   * Separator inserted between pages.
   * Use {n} as a placeholder for the page number.
   * Default: '\n\n=== Page {n} ===\n\n'
   */
  separator?: string;
}

export const defaultPdfToTextParams: PdfToTextParams = {
  separator: '\n\n=== Page {n} ===\n\n',
};
