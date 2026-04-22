export interface CompoundInterestParams {
  principal: number;
  annualRate: number;   // percent, e.g. 7 for 7%
  years: number;
  compoundingPerYear?: number;  // default 12
  monthlyContribution?: number; // default 0
}

export interface YearlyBreakdownRow {
  year: number;
  balance: number;
  contributionTotal: number;
  interestTotal: number;
}

export const defaultCompoundInterestParams: CompoundInterestParams = {
  principal: 10000,
  annualRate: 7,
  years: 10,
  compoundingPerYear: 12,
  monthlyContribution: 0,
};
