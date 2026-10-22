import { expect, it } from 'vitest';
import { compoundInterest } from '../src/tools/compound-interest/index.js';

async function run(params: Record<string, unknown>) {
  const blobs = (await compoundInterest.run(
    [],
    params as unknown as Parameters<typeof compoundInterest.run>[1],
    {
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'compound-test',
      onProgress() {},
    },
  )) as Blob[];
  expect(blobs).toHaveLength(1);
  expect(blobs[0]!.type).toBe('application/json');
  return JSON.parse(await blobs[0]!.text()) as Record<string, unknown>;
}
it('uses monthly equivalent deposit timing for annual compounding', async () => {
  const result = await run({
    principal: 1000,
    annualRate: 10,
    years: 1,
    compoundingPerYear: 1,
    monthlyContribution: 100,
  });
  expect(result.finalBalance).toBe(2354.05);
  expect(result.finalBalanceUnrounded).toBeCloseTo(2354.053661226377, 9);
});
it('distinguishes beginning/end deposits using the encoded monthly effective rate', async () => {
  const params = {
    principal: 0,
    annualRate: 12,
    years: 1,
    compoundingPerYear: 12,
    monthlyContribution: 100,
  };
  expect((await run(params)).finalBalanceUnrounded).toBeCloseTo(1268.2503013196945, 9);
  expect(
    (await run({ ...params, contributionTiming: 'beginning' })).finalBalanceUnrounded,
  ).toBeCloseTo(1280.9328043328915, 9);
});
it('reports inflation-adjusted yearly balances and zero-rate contributions', async () => {
  const result = await run({
    principal: 1000,
    annualRate: 10,
    years: 1,
    compoundingPerYear: 1,
    inflationRate: 10,
  });
  expect(result).toMatchObject({
    finalBalance: 1100,
    realFinalBalance: 1000,
    yearlyBreakdown: [{ year: 1, realBalance: 1000 }],
  });
  expect(
    await run({ principal: 1000, annualRate: 0, years: 1, monthlyContribution: 100 }),
  ).toMatchObject({ finalBalance: 2200, totalInterest: 0 });
});
it('rejects unsupported frequencies, overflow and invalid finite inputs through legacy errors', async () => {
  for (const added of [
    { compoundingPerYear: 3 },
    { annualRate: NaN },
    { principal: Infinity },
    { monthlyContribution: -1 },
    { years: 101 },
    { inflationRate: -100 },
    { contributionTiming: 'guess' },
  ]) {
    const result = await run({ principal: 1000, annualRate: 5, years: 1, ...added });
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe('string');
  }
});
