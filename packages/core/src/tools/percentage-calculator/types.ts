export type PercentageMode =
  | 'percent-of'
  | 'what-percent'
  | 'percent-change'
  | 'increase-decrease';

export interface PercentageCalculatorParams {
  mode: PercentageMode;
  value: number;
  base?: number;
  percent?: number;
}

export const defaultPercentageCalculatorParams: PercentageCalculatorParams = {
  mode: 'percent-of',
  value: 50,
  base: 200,
  percent: 10,
};
