export type DateCalcMode = 'diff' | 'add' | 'day-of-week';
export type DateUnit = 'days' | 'weeks' | 'months' | 'years';

export interface DateCalculatorParams {
  mode: DateCalcMode;
  date1?: string;   // ISO 8601 YYYY-MM-DD
  date2?: string;   // ISO 8601 YYYY-MM-DD (for diff mode)
  amount?: number;  // for add mode
  unit?: DateUnit;  // for add mode
}

export const defaultDateCalculatorParams: DateCalculatorParams = {
  mode: 'diff',
  date1: '2026-01-01',
  date2: '2026-12-31',
  amount: 30,
  unit: 'days',
};
