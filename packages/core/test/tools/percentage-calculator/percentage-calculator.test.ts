import { describe, it, expect } from 'vitest';
import { percentageCalculator } from '../../../src/tools/percentage-calculator/index.js';

const ctx = {
  onProgress: () => {},
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'test',
};

async function run(params: Parameters<typeof percentageCalculator.run>[1]): Promise<Record<string, unknown>> {
  const [blob] = await percentageCalculator.run([], params, ctx) as Blob[];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSON.parse(await blob!.text());
}

describe('percentage-calculator — metadata', () => {
  it('has id percentage-calculator', () => {
    expect(percentageCalculator.id).toBe('percentage-calculator');
  });

  it('is in the create category', () => {
    expect(percentageCalculator.category).toBe('create');
  });

  it('outputs application/json', () => {
    expect(percentageCalculator.output.mime).toBe('application/json');
  });
});

describe('percentage-calculator — modes', () => {
  it('percent-of: 20% of 200 = 40', async () => {
    const r = await run({ mode: 'percent-of', value: 20, base: 200 });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(40, 5);
  });

  it('what-percent: 50 is what % of 200 = 25', async () => {
    const r = await run({ mode: 'what-percent', value: 50, base: 200 });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(25, 5);
  });

  it('percent-change: 100 to 150 = 50% increase', async () => {
    const r = await run({ mode: 'percent-change', value: 100, base: 150 });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(50, 5);
  });

  it('percent-change: 150 to 100 = -33.3% change', async () => {
    const r = await run({ mode: 'percent-change', value: 150, base: 100 });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(-33.333, 2);
  });

  it('increase-decrease: 100 increased by 10% = 110', async () => {
    const r = await run({ mode: 'increase-decrease', value: 100, percent: 10 });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(110, 5);
  });

  it('increase-decrease: 100 decreased by 20% = 80', async () => {
    const r = await run({ mode: 'increase-decrease', value: 100, percent: -20 });
    expect(r.valid).toBe(true);
    expect(r.result).toBeCloseTo(80, 5);
  });

  it('returns valid: false when base is zero for what-percent', async () => {
    const r = await run({ mode: 'what-percent', value: 50, base: 0 });
    expect(r.valid).toBe(false);
  });

  it('includes formatted string', async () => {
    const r = await run({ mode: 'percent-of', value: 25, base: 100 });
    expect(typeof r.formatted).toBe('string');
  });
});
