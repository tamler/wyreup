import { describe, expect, it } from 'vitest';
import { PRICING } from './pricing';
import { costCeilingUsd, NET_USD_PER_CREDIT, WORST_CASE_USD } from './pricing-margin';

describe('PRO pricing margin floor', () => {
  it('uses the $8 / 440-credit plan net of 5% + $0.50 as revenue per credit', () => {
    expect(NET_USD_PER_CREDIT).toBeCloseTo(0.016136, 6);
    expect(costCeilingUsd(1)).toBeCloseTo(0.00807, 5);
  });

  describe.each(Object.entries(WORST_CASE_USD))('%s', (toolId, worstUsd) => {
    it('has a server price', () => {
      expect(PRICING[toolId], toolId).toBeGreaterThan(0);
    });

    it('costs at most half its worst-case net revenue', () => {
      expect(worstUsd).toBeGreaterThan(0);
      expect(worstUsd).toBeLessThanOrEqual(costCeilingUsd(PRICING[toolId]));
    });
  });
});
