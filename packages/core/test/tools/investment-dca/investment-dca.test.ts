import { describe, it, expect } from 'vitest';
import { investmentDca } from '../../../src/tools/investment-dca/index.js';

const ctx = {
  onProgress: () => {},
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'test',
};

async function run(params: Parameters<typeof investmentDca.run>[1]): Promise<Record<string, unknown>> {
  const [blob] = await investmentDca.run([], params, ctx) as Blob[];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSON.parse(await blob!.text());
}

describe('investment-dca — metadata', () => {
  it('has id investment-dca', () => {
    expect(investmentDca.id).toBe('investment-dca');
  });

  it('is in the finance category', () => {
    expect(investmentDca.category).toBe('finance');
  });

  it('outputs application/json', () => {
    expect(investmentDca.output.mime).toBe('application/json');
  });
});

describe('investment-dca — calculations', () => {
  it('flat price: DCA and lump-sum have same average cost', async () => {
    const prices = [100, 100, 100, 100];
    const r = await run({ monthlyContribution: 100, priceHistory: prices });
    expect(r.valid).toBe(true);
    expect(r.dcaAverageCost as number).toBeCloseTo(100, 2);
    expect(r.lumpSumAverageCost as number).toBeCloseTo(100, 2);
  });

  it('totalInvested = monthlyContribution * months', async () => {
    const prices = [100, 110, 120];
    const r = await run({ monthlyContribution: 200, priceHistory: prices });
    expect(r.valid).toBe(true);
    expect(r.totalInvested).toBeCloseTo(600, 2);
  });

  it('falling prices: DCA buys more shares than lump-sum', async () => {
    const prices = [100, 80, 60, 40, 20];
    const r = await run({ monthlyContribution: 100, priceHistory: prices });
    expect(r.valid).toBe(true);
    expect(r.dcaTotalShares as number).toBeGreaterThan(r.lumpSumTotalShares as number);
  });

  it('rising prices from start: lump-sum usually wins', async () => {
    // All prices rise: lump-sum buys at the lowest price
    const prices = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const r = await run({ monthlyContribution: 100, priceHistory: prices });
    expect(r.valid).toBe(true);
    expect(r.lumpSumFinalValue as number).toBeGreaterThan(r.dcaFinalValue as number);
    expect(r.dcaWins).toBe(false);
  });

  it('returns valid: false for empty priceHistory', async () => {
    const r = await run({ monthlyContribution: 100, priceHistory: [] });
    expect(r.valid).toBe(false);
  });

  it('returns valid: false for non-positive contribution', async () => {
    const r = await run({ monthlyContribution: 0, priceHistory: [100, 200] });
    expect(r.valid).toBe(false);
  });

  it('returns valid: false for negative price in history', async () => {
    const r = await run({ monthlyContribution: 100, priceHistory: [100, -50] });
    expect(r.valid).toBe(false);
  });
});
