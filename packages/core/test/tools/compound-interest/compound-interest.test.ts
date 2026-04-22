import { describe, it, expect } from 'vitest';
import { compoundInterest } from '../../../src/tools/compound-interest/index.js';

const ctx = {
  onProgress: () => {},
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'test',
};

async function run(params: Parameters<typeof compoundInterest.run>[1]): Promise<Record<string, unknown>> {
  const [blob] = await compoundInterest.run([], params, ctx) as Blob[];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSON.parse(await blob!.text());
}

describe('compound-interest — metadata', () => {
  it('has id compound-interest', () => {
    expect(compoundInterest.id).toBe('compound-interest');
  });

  it('is in the finance category', () => {
    expect(compoundInterest.category).toBe('finance');
  });

  it('outputs application/json', () => {
    expect(compoundInterest.output.mime).toBe('application/json');
  });
});

describe('compound-interest — calculations', () => {
  it('$10k at 10% for 1 year (monthly compounding) ≈ $11047', async () => {
    const r = await run({ principal: 10000, annualRate: 10, years: 1, compoundingPerYear: 12, monthlyContribution: 0 });
    expect(r.valid).toBe(true);
    expect(r.finalBalance as number).toBeCloseTo(11047, 0);
  });

  it('produces a yearly breakdown array with correct length', async () => {
    const r = await run({ principal: 1000, annualRate: 5, years: 5, compoundingPerYear: 12, monthlyContribution: 0 });
    expect(r.valid).toBe(true);
    const breakdown = r.yearlyBreakdown as unknown[];
    expect(breakdown).toHaveLength(5);
  });

  it('total interest = finalBalance - totalContributions', async () => {
    const r = await run({ principal: 5000, annualRate: 7, years: 10, compoundingPerYear: 12, monthlyContribution: 100 });
    expect(r.valid).toBe(true);
    const balance = r.finalBalance as number;
    const contributions = r.totalContributions as number;
    const interest = r.totalInterest as number;
    expect(Math.abs(balance - contributions - interest)).toBeLessThan(1);
  });

  it('monthly contributions increase the final balance', async () => {
    const noContrib = await run({ principal: 10000, annualRate: 7, years: 10, compoundingPerYear: 12, monthlyContribution: 0 });
    const withContrib = await run({ principal: 10000, annualRate: 7, years: 10, compoundingPerYear: 12, monthlyContribution: 200 });
    expect((withContrib.finalBalance as number) > (noContrib.finalBalance as number)).toBe(true);
  });

  it('returns valid: false for negative principal', async () => {
    const r = await run({ principal: -1000, annualRate: 5, years: 5, compoundingPerYear: 12 });
    expect(r.valid).toBe(false);
  });

  it('returns valid: false for non-integer years', async () => {
    const r = await run({ principal: 1000, annualRate: 5, years: 1.5, compoundingPerYear: 12 });
    expect(r.valid).toBe(false);
  });

  it('0% interest = principal only grows by contributions', async () => {
    const r = await run({ principal: 1000, annualRate: 0, years: 1, compoundingPerYear: 12, monthlyContribution: 100 });
    expect(r.valid).toBe(true);
    expect(r.totalInterest as number).toBeCloseTo(0, 0);
  });
});
