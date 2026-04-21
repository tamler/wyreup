export interface RotatePdfParams {
  /** Rotation in degrees. Must be 90, 180, or 270. */
  degrees: 90 | 180 | 270;
  /**
   * Which pages to rotate. 'all' rotates every page.
   * 'odd' rotates pages 1, 3, 5, ... 'even' rotates 2, 4, 6, ...
   * A comma-separated string of page numbers (1-indexed) rotates specific pages.
   */
  pages: string;
}

export const defaultRotatePdfParams: RotatePdfParams = {
  degrees: 90,
  pages: 'all',
};
