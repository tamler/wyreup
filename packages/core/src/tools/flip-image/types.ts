export interface FlipImageParams {
  /** Direction of the flip. */
  direction: 'horizontal' | 'vertical';
}

export const defaultFlipImageParams: FlipImageParams = {
  direction: 'horizontal',
};
