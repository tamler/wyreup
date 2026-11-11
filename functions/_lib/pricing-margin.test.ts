// Cost-model guard: a Pro tool's worst-case Cloudflare cost per run must stay
// at or below 50% of the worst-case net revenue for the credits it charges.
//
// Worst-case revenue per credit is the $8 plan for 440 credits, net of
// 5% + $0.50 payment fees: (8 x 0.95 - 0.50) / 440 = $0.016136.
//
// Each row derives its worst case from the caps the code actually enforces,
// so raising a cap without re-pricing fails here.

import { describe, expect, it, vi } from 'vitest';
import { PRICING } from './pricing';
import { runPro } from './runners';
import type { Env } from './env';
import {
  IMAGE_GEN_HD_CALLS_PER_RUN,
  IMAGE_GEN_HD_INPUT_IMAGES,
  IMAGE_GEN_HD_MAX_OUTPUT_PIXELS,
  IMAGE_GEN_HD_PRICE_EXTRA_MP_USD,
  IMAGE_GEN_HD_PRICE_FIRST_MP_USD,
  IMAGE_GEN_HD_PRICE_INPUT_MP_USD,
  IMAGE_GEN_HD_SIZES,
} from './providers/image-gen-hd-models';

const NET_REVENUE_PER_CREDIT_USD = (8 * 0.95 - 0.5) / 440;
const MAX_COST_SHARE = 0.5;

/**
 * FLUX.2 [klein] 9B bills per output megapixel ($0.015 first, $0.002 each
 * extra) and per input image megapixel. Megapixels are counted as 10^6
 * pixels and rounded up, the more expensive reading of the price sheet.
 */
const klein9bCallUsd = (outputPixels: number, inputImageMp: number) =>
  IMAGE_GEN_HD_PRICE_FIRST_MP_USD +
  Math.max(0, Math.ceil(outputPixels / 1_000_000) - 1) * IMAGE_GEN_HD_PRICE_EXTRA_MP_USD +
  inputImageMp * IMAGE_GEN_HD_PRICE_INPUT_MP_USD;

const largestHdOutputPixels = Math.max(
  ...Object.values(IMAGE_GEN_HD_SIZES).map((s) => s.width * s.height),
);

/**
 * Worst-case USD per run. A run makes one provider call with no retry or
 * fallback; a failed call may still be billed, and the credit is refunded,
 * so the worst billed cost per charged run is one call.
 */
const WORST_CASE_USD: Record<string, number> = {
  'image-generate-hd-pro':
    IMAGE_GEN_HD_CALLS_PER_RUN * klein9bCallUsd(largestHdOutputPixels, IMAGE_GEN_HD_INPUT_IMAGES),
};

describe('Pro pricing margin floor', () => {
  it('uses the charter revenue figure', () => {
    expect(NET_REVENUE_PER_CREDIT_USD).toBeCloseTo(0.016136, 6);
  });

  it.each(Object.entries(WORST_CASE_USD))(
    '%s worst-case cost is at most half its net revenue',
    (toolId, usd) => {
      const credits = PRICING[toolId];
      expect(credits, `${toolId} has no server price`).toBeGreaterThan(0);
      expect(usd).toBeLessThanOrEqual(credits * NET_REVENUE_PER_CREDIT_USD * MAX_COST_SHARE);
    },
  );

  it('image-generate-hd-pro worst case is one first-megapixel call with no input images', () => {
    expect(largestHdOutputPixels).toBeLessThanOrEqual(IMAGE_GEN_HD_MAX_OUTPUT_PIXELS);
    expect(IMAGE_GEN_HD_MAX_OUTPUT_PIXELS).toBeLessThanOrEqual(1_000_000);
    expect(IMAGE_GEN_HD_INPUT_IMAGES).toBe(0);
    expect(IMAGE_GEN_HD_CALLS_PER_RUN).toBe(1);
    expect(WORST_CASE_USD['image-generate-hd-pro']).toBeCloseTo(0.015, 9);
  });

  it('image-generate-hd-pro calls the model exactly once, even when the call fails', async () => {
    const run = vi.fn().mockRejectedValue(new Error('upstream 500'));
    const env = { AI: { run } } as unknown as Env;
    await expect(
      runPro('image-generate-hd-pro', { prompt: 'a lighthouse' }, env),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(IMAGE_GEN_HD_CALLS_PER_RUN);
  });
});
