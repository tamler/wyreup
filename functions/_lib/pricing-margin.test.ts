// Cost-model guard: a Pro tool's worst-case Cloudflare cost per run must stay
// at or below 50% of the worst-case net revenue for the credits it charges.
//
// Worst-case revenue per credit is the $8 plan for 440 credits, net of
// 5% + $0.50 payment fees: (8 x 0.95 - 0.50) / 440 = $0.016136.
//
// Each row comes from a worst-case function exported next to the caps the
// provider enforces, so raising a cap without re-pricing fails here.

import { describe, expect, it } from 'vitest';
import { PRICING } from './pricing';
import { photoEditWorstCaseUsd } from './providers/photo-edit-models';

const NET_USD_PER_CREDIT = (8 * 0.95 - 0.5) / 440;
const MAX_COST_SHARE = 0.5;
const costCeilingUsd = (credits: number) => credits * NET_USD_PER_CREDIT * MAX_COST_SHARE;

const WORST_CASE_USD: Record<string, number> = {
  'photo-edit-pro': photoEditWorstCaseUsd(),
};

describe('Pro pricing margin floor', () => {
  it('uses the charter revenue figure', () => {
    expect(NET_USD_PER_CREDIT).toBeCloseTo(0.016136, 6);
  });

  it.each(Object.entries(WORST_CASE_USD))(
    '%s worst-case cost is at most half its net revenue',
    (toolId, usd) => {
      const credits = PRICING[toolId];
      expect(credits, `${toolId} has no server price`).toBeGreaterThan(0);
      expect(usd).toBeLessThanOrEqual(costCeilingUsd(credits));
    },
  );

  it('photo-edit-pro worst case is one input tile and four output tiles', () => {
    expect(photoEditWorstCaseUsd()).toBeCloseTo(0.000059 + 4 * 0.000287, 9);
  });
});
