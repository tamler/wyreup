import { expect, it } from 'vitest';
import { dateCalculator } from '../src/tools/date-calculator/index.js';

async function run(params: Record<string, unknown>) {
  const output = await dateCalculator.run(
    [],
    params as unknown as Parameters<typeof dateCalculator.run>[1],
    {
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'calendar-test',
      onProgress() {},
    },
  );
  expect(Array.isArray(output)).toBe(true);
  const blobs = output as Blob[];
  expect(blobs).toHaveLength(1);
  expect(blobs[0]!.type).toBe('application/json');
  return JSON.parse(await blobs[0]!.text()) as Record<string, unknown>;
}

it('counts exact signed calendar units and half-open business days', async () => {
  const forward = await run({ mode: 'diff', date1: '2026-01-02', date2: '2026-01-06' });
  expect(forward).toMatchObject({
    valid: true,
    totalDays: 4,
    totalHours: 96,
    totalWeeks: 4 / 7,
    businessDays: 2,
  });
  expect(await run({ mode: 'diff', date1: '2026-01-06', date2: '2026-01-02' })).toMatchObject({
    totalDays: -4,
    businessDays: -2,
    breakdown: { years: 0, months: 0, days: -4 },
  });
  expect(await run({ mode: 'diff', date1: '2026-01-02', date2: '2026-01-02' })).toMatchObject({
    totalDays: 0,
    businessDays: 0,
  });
  expect(await run({ mode: 'diff', date1: '2024-01-31', date2: '2025-03-02' })).toMatchObject({
    breakdown: { years: 1, months: 1, days: 2 },
  });
});
it('applies custom weekends and holidays without double subtraction', async () => {
  expect(
    await run({
      mode: 'diff',
      date1: '2026-01-02',
      date2: '2026-01-06',
      holidays: ['2026-01-02', '2026-01-03'],
    }),
  ).toMatchObject({ businessDays: 1 });
  expect(
    await run({ mode: 'diff', date1: '2026-01-02', date2: '2026-01-06', weekend: [] }),
  ).toMatchObject({ businessDays: 4 });
  expect(
    await run({ mode: 'diff', date1: '2026-01-02', date2: '2026-01-06', weekend: [5, 6] }),
  ).toMatchObject({ businessDays: 2 });
});
it('constrains month and leap-year arithmetic and preserves day indexes', async () => {
  expect(await run({ mode: 'add', date1: '2026-01-31', amount: 1, unit: 'months' })).toMatchObject({
    valid: true,
    result: '2026-02-28',
  });
  expect(await run({ mode: 'add', date1: '2024-02-29', amount: 1, unit: 'years' })).toMatchObject({
    result: '2025-02-28',
  });
  expect(
    await run({ mode: 'add', date1: '2026-01-31', amount: 1, unit: 'months', overflow: 'reject' }),
  ).toMatchObject({ valid: false });
  expect(await run({ mode: 'day-of-week', date1: '2026-01-04' })).toMatchObject({
    dayIndex: 0,
    dayName: 'Sunday',
  });
});
it('resolves invalid dates/options to the legacy JSON error shape', async () => {
  for (const params of [
    { mode: 'diff', date1: '2026-02-30', date2: '2026-03-01' },
    { mode: 'diff', date1: '1899-12-31', date2: '2026-03-01' },
    { mode: 'diff', date1: '2026-01-01', date2: '2026-03-01', weekend: [6, 6] },
    { mode: 'diff', date1: '2026-01-01', date2: '2026-03-01', holidays: ['2026-02-30'] },
    { mode: 'add', date1: '2026-01-01', amount: 0.5, unit: 'days' },
    { mode: 'add', date1: '2026-01-01', amount: 1, unit: 'days', overflow: 'guess' },
    { mode: 'add', date1: '2100-12-31', amount: 1, unit: 'days' },
  ]) {
    const result = await run(params);
    expect(result.valid).toBe(false);
    expect(typeof result.error).toBe('string');
  }
});
