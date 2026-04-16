export interface PageNumbersPdfParams {
  /** Corner position. Default 'bottom-center'. */
  position: 'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right';
  /** Font size in points. Default 12. */
  fontSize?: number;
  /** Starting number. Default 1. */
  startAt?: number;
  /** Format string; "{n}" is replaced with the page number. Example: "Page {n}". Default "{n}". */
  format?: string;
}

export const defaultPageNumbersPdfParams: PageNumbersPdfParams = {
  position: 'bottom-center',
  fontSize: 12,
  startAt: 1,
  format: '{n}',
};
