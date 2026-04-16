export interface ImageToPdfParams {
  /** 'auto' sizes each page to the image dimensions; 'a4' / 'letter' use standard sizes. Default 'auto'. */
  pageSize?: 'auto' | 'a4' | 'letter';
  /** Page margin in points when using a4/letter. Default 36 (0.5 inch). */
  margin?: number;
}

export const defaultImageToPdfParams: ImageToPdfParams = {
  pageSize: 'auto',
  margin: 36,
};
