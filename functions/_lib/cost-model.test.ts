import { describe, expect, it } from 'vitest';
import { WORST_CASES, WORST_NET_USD_PER_CREDIT, floorUsd } from './cost-model';

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

  it('pins text-checklist-pro at 1 credit and about $0.00093 per run', () => {
    const c = WORST_CASES.find((w) => w.toolId === 'text-checklist-pro')!;
    expect(floorUsd('text-checklist-pro')).toBeCloseTo(0.008068, 6);
    expect(c.usd).toBeLessThan(0.00094);
  });
});
