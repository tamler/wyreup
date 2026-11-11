// Cost-model guard: a Pro run's worst-case Cloudflare cost must stay at or
// below 50% of the worst-case net revenue for the credits it charges.
//
// Worst-case revenue per credit is the $8 / 440-credit monthly plan net of
// payment fees (5% + $0.50 per transaction): (8 x 0.95 - 0.50) / 440.
// Each row's worst case must count max input, max output, every retry and
// any fallback call after a failed (possibly billed) primary call.

import { describe, it, expect } from 'vitest';
import { PRICING } from './pricing';
import { receiptWorstCaseUsd } from './providers/receipt-models';

const NET_USD_PER_CREDIT = (8 * 0.95 - 0.5) / 440;
const MAX_COST_SHARE = 0.5;

const WORST_CASE_USD: Record<string, () => number> = {
  'receipt-extract-pro': () => receiptWorstCaseUsd().worstUsd,
};

describe('Pro pricing margin floor', () => {
  it.each(Object.keys(WORST_CASE_USD))('%s worst-case cost clears the floor', (toolId) => {
    const credits = PRICING[toolId];
    expect(credits, `${toolId} has no server price`).toBeTypeOf('number');
    const cost = WORST_CASE_USD[toolId]();
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThanOrEqual(credits * NET_USD_PER_CREDIT * MAX_COST_SHARE);
  });

  it('receipt-extract-pro is priced at the lowest credit count that clears', () => {
    const cost = receiptWorstCaseUsd().worstUsd;
    const lowest = Math.ceil(cost / (NET_USD_PER_CREDIT * MAX_COST_SHARE));
    expect(PRICING['receipt-extract-pro']).toBe(lowest);
  });
});
