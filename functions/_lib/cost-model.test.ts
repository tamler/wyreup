import { describe, expect, it } from 'vitest';
import { WORST_CASES, WORST_NET_USD_PER_CREDIT, floorUsd } from './cost-model';
import { PRICING } from './pricing';

describe('Pro cost model', () => {
  it('uses the approved worst-case revenue per credit', () => {
    expect(WORST_NET_USD_PER_CREDIT).toBeCloseTo(0.016136, 6);
  });

  it.each(WORST_CASES.map((c) => [c.toolId, c]))(
    '%s worst-case Cloudflare cost is at most 50% of worst-case net revenue',
    (_id, c) => {
      expect(c.usd, c.detail).toBeGreaterThan(0);
      expect(c.usd, c.detail).toBeLessThanOrEqual(floorUsd(c.toolId));
    },
  );

  it('models the similarity tools at 1 credit each', () => {
    const modelled = new Set(WORST_CASES.map((c) => c.toolId));
    for (const id of ['text-find-similar-pro', 'rank-results-pro', 'text-cluster-pro']) {
      expect(modelled.has(id), id).toBe(true);
      expect(PRICING[id], id).toBe(1);
    }
  });
});
