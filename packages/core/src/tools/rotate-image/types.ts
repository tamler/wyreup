export interface RotateImageParams {
  /** Rotation angle in degrees. Must be 90, 180, or 270. */
  degrees: 90 | 180 | 270;
}

export const defaultRotateImageParams: RotateImageParams = {
  degrees: 90,
};
