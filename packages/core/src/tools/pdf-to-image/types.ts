export interface PdfToImageParams {
  /** DPI for rendering. Default 150. Higher = sharper but larger files. */
  dpi?: number;
  /** Which pages to render. 'all' renders every page, or comma-separated 1-indexed like "1,3,5". */
  pages?: 'all' | string;
}

export const defaultPdfToImageParams: PdfToImageParams = {
  dpi: 150,
  pages: 'all',
};
