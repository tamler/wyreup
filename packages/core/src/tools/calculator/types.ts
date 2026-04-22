export type AngleMode = 'deg' | 'rad';

export interface CalculatorParams {
  expression: string;
  angleMode?: AngleMode;
}

export const defaultCalculatorParams: CalculatorParams = {
  expression: '',
  angleMode: 'deg',
};
