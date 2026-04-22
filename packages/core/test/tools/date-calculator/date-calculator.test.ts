import { describe, it, expect } from 'vitest';
import { dateCalculator } from '../../../src/tools/date-calculator/index.js';

const ctx = {
  onProgress: () => {},
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'test',
};

async function run(params: Parameters<typeof dateCalculator.run>[1]): Promise<Record<string, unknown>> {
  const [blob] = await dateCalculator.run([], params, ctx) as Blob[];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return JSON.parse(await blob!.text());
}

describe('date-calculator — metadata', () => {
  it('has id date-calculator', () => {
    expect(dateCalculator.id).toBe('date-calculator');
  });

  it('is in the create category', () => {
    expect(dateCalculator.category).toBe('create');
  });

  it('outputs application/json', () => {
    expect(dateCalculator.output.mime).toBe('application/json');
  });
});

describe('date-calculator — diff mode', () => {
  it('calculates 365 days between Jan 1 and Dec 31 of same year', async () => {
    const r = await run({ mode: 'diff', date1: '2026-01-01', date2: '2026-12-31' });
    expect(r.valid).toBe(true);
    expect(r.totalDays).toBe(364);
  });

  it('returns negative days when date2 is before date1', async () => {
    const r = await run({ mode: 'diff', date1: '2026-12-31', date2: '2026-01-01' });
    expect(r.valid).toBe(true);
    expect(r.totalDays as number).toBeLessThan(0);
  });

  it('includes breakdown with years/months/days', async () => {
    const r = await run({ mode: 'diff', date1: '2020-01-01', date2: '2026-01-01' });
    expect(r.valid).toBe(true);
    expect(r.breakdown).toBeDefined();
    const bd = r.breakdown as { years: number; months: number; days: number };
    expect(bd.years).toBe(6);
  });

  it('returns valid: false for invalid date format', async () => {
    const r = await run({ mode: 'diff', date1: '01/01/2026', date2: '2026-12-31' });
    expect(r.valid).toBe(false);
    expect(r.error).toBeDefined();
  });
});

describe('date-calculator — add mode', () => {
  it('adds 30 days to 2026-01-01', async () => {
    const r = await run({ mode: 'add', date1: '2026-01-01', amount: 30, unit: 'days' });
    expect(r.valid).toBe(true);
    expect(r.result).toBe('2026-01-31');
  });

  it('adds 1 year to 2026-01-01', async () => {
    const r = await run({ mode: 'add', date1: '2026-01-01', amount: 1, unit: 'years' });
    expect(r.valid).toBe(true);
    expect(r.result).toBe('2027-01-01');
  });

  it('adds 2 weeks', async () => {
    const r = await run({ mode: 'add', date1: '2026-01-01', amount: 2, unit: 'weeks' });
    expect(r.valid).toBe(true);
    expect(r.result).toBe('2026-01-15');
  });
});

describe('date-calculator — day-of-week mode', () => {
  it('2026-01-01 is a Thursday', async () => {
    const r = await run({ mode: 'day-of-week', date1: '2026-01-01' });
    expect(r.valid).toBe(true);
    expect(r.dayName).toBe('Thursday');
  });

  it('returns valid: false for garbage date', async () => {
    const r = await run({ mode: 'day-of-week', date1: 'not-a-date' });
    expect(r.valid).toBe(false);
  });
});
