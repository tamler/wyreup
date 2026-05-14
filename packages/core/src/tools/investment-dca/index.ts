import type { ToolModule, ToolRunContext } from '../../types.js';
import type { InvestmentDcaParams } from './types.js';

export type { InvestmentDcaParams } from './types.js';
export { defaultInvestmentDcaParams } from './types.js';

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const investmentDca: ToolModule<InvestmentDcaParams> = {
  id: 'investment-dca',
  slug: 'investment-dca',
  name: 'DCA Calculator',
  description: 'Compare dollar-cost averaging vs. lump-sum investing using historical price data.',
  category: 'finance',
  keywords: ['dca', 'dollar cost averaging', 'investment', 'shares', 'finance', 'lump sum', 'portfolio'],

  input: { accept: [], min: 0, max: 0 },
  output: { mime: 'application/json', multiple: false },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    monthlyContribution: 500,
    priceHistory: [100, 95, 110, 105, 120, 115, 130, 125, 140, 135, 150, 145],
  },

   
  async run(
    _inputs: File[],
    params: InvestmentDcaParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Computing DCA vs lump-sum' });

    let result: Record<string, unknown>;

    try {
      const { monthlyContribution, priceHistory } = params;

      if (monthlyContribution <= 0) throw new Error('Monthly contribution must be positive');
      if (!Array.isArray(priceHistory) || priceHistory.length === 0) {
        throw new Error('priceHistory must be a non-empty array of prices');
      }
      if (priceHistory.some((p) => p <= 0)) {
        throw new Error('All prices in priceHistory must be positive');
      }

      const months = priceHistory.length;
      const totalInvested = monthlyContribution * months;
      const endPrice = priceHistory[months - 1]!;

      // DCA: buy monthlyContribution / price[i] shares each month
      let dcaShares = 0;
      for (let i = 0; i < months; i++) {
        dcaShares += monthlyContribution / priceHistory[i]!;
      }
      const dcaTotalShares = round6(dcaShares);
      const dcaAverageCost = round2(totalInvested / dcaTotalShares);
      const dcaFinalValue = round2(dcaTotalShares * endPrice);

      // Lump-sum: invest all money at month 0 price
      const startPrice = priceHistory[0]!;
      const lumpSumShares = round6(totalInvested / startPrice);
      const lumpSumAverageCost = round2(startPrice);
      const lumpSumFinalValue = round2(lumpSumShares * endPrice);

      result = {
        valid: true,
        totalInvested: round2(totalInvested),
        months,
        endPrice,
        dcaTotalShares,
        dcaAverageCost,
        dcaFinalValue,
        lumpSumTotalShares: lumpSumShares,
        lumpSumAverageCost,
        lumpSumFinalValue,
        dcaWins: dcaFinalValue > lumpSumFinalValue,
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
