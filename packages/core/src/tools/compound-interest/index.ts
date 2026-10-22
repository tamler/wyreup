import type { ToolModule, ToolRunContext } from '../../types.js';
import type { CompoundInterestParams, YearlyBreakdownRow } from './types.js';
import { cloneUtilityJson } from '../../utilities/common.js';

export type { CompoundInterestParams, YearlyBreakdownRow } from './types.js';
export { defaultCompoundInterestParams } from './types.js';

function round2(n: number): number {
  const rounded = Math.round(n * 100) / 100;
  if (!Number.isFinite(rounded))
    throw new Error('The rounded projection exceeds finite numeric limits.');
  return rounded;
}

export const compoundInterest: ToolModule<CompoundInterestParams> = {
  id: 'compound-interest',
  slug: 'compound-interest',
  name: 'Compound Interest',
  description:
    'Calculate compound interest with optional monthly contributions and a year-by-year breakdown.',
  category: 'finance',
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
    inflationRate: 0,
    contributionTiming: 'end',
  },
  paramSchema: {
    principal: { type: 'number', label: 'Initial balance', min: 0, max: 1000000000000 },
    annualRate: { type: 'number', label: 'Annual nominal return (%)', min: 0, max: 1000 },
    years: { type: 'number', label: 'Years', min: 1, max: 100, step: 1 },
    compoundingPerYear: {
      type: 'enum',
      label: 'Compounding periods per year',
      options: [1, 2, 4, 12, 52, 365].map((value) => ({ value, label: String(value) })),
    },
    monthlyContribution: { type: 'number', label: 'Monthly deposit', min: 0, max: 1000000000 },
    inflationRate: { type: 'number', label: 'Annual inflation (%)', min: -99.999999, max: 1000 },
    contributionTiming: {
      type: 'enum',
      label: 'Deposit timing',
      options: [
        { value: 'end', label: 'End of month' },
        { value: 'beginning', label: 'Beginning of month' },
      ],
    },
  },

  async run(_inputs: File[], params: CompoundInterestParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new DOMException('Compound calculation cancelled.', 'AbortError');
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Computing compound interest' });

    let result: Record<string, unknown>;

    try {
      params = cloneUtilityJson(params) as unknown as CompoundInterestParams;
      if (
        !params ||
        typeof params !== 'object' ||
        Array.isArray(params) ||
        Object.keys(params).some(
          (key) =>
            ![
              'principal',
              'annualRate',
              'years',
              'compoundingPerYear',
              'monthlyContribution',
              'inflationRate',
              'contributionTiming',
            ].includes(key),
        )
      )
        throw new Error('Unknown or invalid compound-interest parameters.');
      const { principal, annualRate, years } = params;
      const n = params.compoundingPerYear ?? 12;
      const monthly = params.monthlyContribution ?? 0;
      const inflation = params.inflationRate ?? 0;
      const timing = params.contributionTiming ?? 'end';
      if (
        typeof principal !== 'number' ||
        !Number.isFinite(principal) ||
        principal < 0 ||
        principal > 1000000000000
      )
        throw new Error('Initial balance must be finite and between 0 and 1 trillion.');
      if (
        typeof annualRate !== 'number' ||
        !Number.isFinite(annualRate) ||
        annualRate < 0 ||
        annualRate > 1000
      )
        throw new Error('Annual return must be finite and between 0 and 1000%.');
      if (!Number.isInteger(years) || years < 1 || years > 100)
        throw new Error('Years must be a whole number from 1 to 100.');
      if (![1, 2, 4, 12, 52, 365].includes(n))
        throw new Error('Choose a supported compounding frequency.');
      if (
        typeof monthly !== 'number' ||
        !Number.isFinite(monthly) ||
        monthly < 0 ||
        monthly > 1000000000
      )
        throw new Error('Monthly deposits must be finite and between 0 and 1 billion.');
      if (
        typeof inflation !== 'number' ||
        !Number.isFinite(inflation) ||
        inflation <= -100 ||
        inflation > 1000
      )
        throw new Error('Inflation must be finite, greater than -100% and at most 1000%.');
      if (timing !== 'end' && timing !== 'beginning')
        throw new Error('Choose beginning or end-of-month deposits.');
      const monthlyRate = Math.expm1((n / 12) * Math.log1p(annualRate / 100 / n));

      const yearlyBreakdown: YearlyBreakdownRow[] = [];
      let balance = principal;
      let contributionTotal = principal;
      for (let month = 1; month <= years * 12; month++) {
        if (ctx.signal.aborted)
          throw new DOMException('Compound calculation cancelled.', 'AbortError');
        balance =
          timing === 'beginning'
            ? (balance + monthly) * (1 + monthlyRate)
            : balance * (1 + monthlyRate) + monthly;
        contributionTotal += monthly;
        if (!Number.isFinite(balance))
          throw new Error('The requested projection exceeds finite numeric limits.');
        if (month % 12 === 0) {
          const year = month / 12;
          const realBalance = balance / Math.pow(1 + inflation / 100, year);
          if (!Number.isFinite(realBalance))
            throw new Error('The inflation-adjusted projection exceeds finite numeric limits.');
          yearlyBreakdown.push({
            year,
            balance: round2(balance),
            contributionTotal: round2(contributionTotal),
            interestTotal: round2(balance - contributionTotal),
            realBalance: round2(realBalance),
          });
        }
      }

      const finalBalance = round2(balance);
      const totalContributions = round2(contributionTotal);
      const totalInterest = round2(finalBalance - totalContributions);

      result = {
        valid: true,
        inputs: {
          principal,
          annualRate,
          years,
          compoundingPerYear: n,
          monthlyContribution: monthly,
          inflationRate: inflation,
          contributionTiming: timing,
        },
        finalBalance,
        finalBalanceUnrounded: balance,
        realFinalBalance: yearlyBreakdown[yearlyBreakdown.length - 1]!.realBalance,
        monthlyEffectiveRate: monthlyRate,
        assumptions:
          'Fixed nominal return and inflation examples. Monthly deposits use the equivalent effective monthly rate, including nonmonthly compounding; this is not provider-specific daily deposit accounting.',
        totalContributions,
        totalInterest,
        yearlyBreakdown,
      };
    } catch (err) {
      if (ctx.signal.aborted)
        throw new DOMException('Compound calculation cancelled.', 'AbortError');
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
