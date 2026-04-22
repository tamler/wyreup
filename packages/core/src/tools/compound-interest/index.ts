import type { ToolModule, ToolRunContext } from '../../types.js';
import type { CompoundInterestParams, YearlyBreakdownRow } from './types.js';

export type { CompoundInterestParams, YearlyBreakdownRow } from './types.js';
export { defaultCompoundInterestParams } from './types.js';

const CompoundInterestComponentStub = (): unknown => null;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const compoundInterest: ToolModule<CompoundInterestParams> = {
  id: 'compound-interest',
  slug: 'compound-interest',
  name: 'Compound Interest',
  description: 'Calculate compound interest with optional monthly contributions and a year-by-year breakdown.',
  category: 'finance',
  presence: 'both',
  keywords: ['compound', 'interest', 'investment', 'savings', 'finance', 'calculator', 'APR'],

  input: { accept: [], min: 0, max: 0 },
  output: { mime: 'application/json', multiple: false },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    principal: 10000,
    annualRate: 7,
    years: 10,
    compoundingPerYear: 12,
    monthlyContribution: 0,
  },

  Component: CompoundInterestComponentStub,

  // eslint-disable-next-line @typescript-eslint/require-await
  async run(
    _inputs: File[],
    params: CompoundInterestParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Computing compound interest' });

    let result: Record<string, unknown>;

    try {
      const { principal, annualRate, years } = params;
      const n = params.compoundingPerYear ?? 12;
      const monthly = params.monthlyContribution ?? 0;

      if (principal < 0) throw new Error('Principal must be non-negative');
      if (annualRate < 0) throw new Error('Annual rate must be non-negative');
      if (years <= 0 || !Number.isInteger(years)) throw new Error('Years must be a positive integer');
      if (n <= 0) throw new Error('Compounding periods must be positive');

      const ratePerPeriod = annualRate / 100 / n;
      const periodsPerYear = n;
      const monthlyPeriodRatio = n / 12; // how many compounding periods per month

      const yearlyBreakdown: YearlyBreakdownRow[] = [];
      let balance = principal;
      let contributionTotal = principal;
      const totalPeriods = years * n;

      // Simulate period by period
      for (let period = 1; period <= totalPeriods; period++) {
        // Add monthly contribution every (n/12) periods — simplified: add contribution per compounding period
        // Convert monthly contribution to per-compounding-period
        const contribThisPeriod = monthly / monthlyPeriodRatio;
        balance = balance * (1 + ratePerPeriod) + contribThisPeriod;
        contributionTotal += contribThisPeriod;

        // Record at each year end
        if (period % periodsPerYear === 0) {
          const year = period / periodsPerYear;
          yearlyBreakdown.push({
            year,
            balance: round2(balance),
            contributionTotal: round2(contributionTotal),
            interestTotal: round2(balance - contributionTotal),
          });
        }
      }

      const finalBalance = round2(balance);
      const totalContributions = round2(contributionTotal);
      const totalInterest = round2(finalBalance - totalContributions);

      result = {
        valid: true,
        inputs: { principal, annualRate, years, compoundingPerYear: n, monthlyContribution: monthly },
        finalBalance,
        totalContributions,
        totalInterest,
        yearlyBreakdown,
      };
    } catch (err) {
      result = { valid: false, error: err instanceof Error ? err.message : String(err) };
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
