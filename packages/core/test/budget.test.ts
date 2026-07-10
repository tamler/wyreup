import { describe, it, expect } from 'vitest';
import {
  assertPdfPageBudget,
  assertDurationBudget,
  assertDimensionsBudget,
  BudgetExceededError,
} from '../src/lib/budget.js';

describe('assertPdfPageBudget', () => {
  it('passes within limit', () => {
    expect(() => assertPdfPageBudget(100, { maxPages: 1000 })).not.toThrow();
  });

  it('rejects over limit', () => {
    expect(() => assertPdfPageBudget(1001, { maxPages: 1000 })).toThrow(BudgetExceededError);
  });

  it('is a no-op when budget undefined', () => {
    expect(() => assertPdfPageBudget(999_999, undefined)).not.toThrow();
  });

  it('is a no-op when maxPages is undefined', () => {
    expect(() => assertPdfPageBudget(999_999, {})).not.toThrow();
  });
});

describe('assertDurationBudget', () => {
  it('passes within limit', () => {
    expect(() => assertDurationBudget(3600, { maxDuration: 7200 })).not.toThrow();
  });
  it('rejects over limit', () => {
    expect(() => assertDurationBudget(7201, { maxDuration: 7200 })).toThrow(BudgetExceededError);
  });
});

describe('assertDimensionsBudget', () => {
  it('passes within both dims', () => {
    expect(() =>
      assertDimensionsBudget(1920, 1080, { maxDimensions: { width: 4096, height: 4096 } }),
    ).not.toThrow();
  });
  it('rejects when width over', () => {
    expect(() =>
      assertDimensionsBudget(5000, 1080, { maxDimensions: { width: 4096, height: 4096 } }),
    ).toThrow(BudgetExceededError);
  });
});
