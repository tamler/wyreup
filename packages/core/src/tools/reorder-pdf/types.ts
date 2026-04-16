export interface ReorderPdfParams {
  /**
   * New page order as comma-separated 1-indexed page numbers.
   * Missing pages are omitted; duplicates are allowed.
   * Example for a 3-page PDF, reversing: "3,2,1"
   */
  order: string;
}

export const defaultReorderPdfParams: ReorderPdfParams = {
  order: '',
};
