import { describe, expect, it } from 'vitest';
import {
  UNBOUNDED_TOOLS,
  WORST_CASES,
  WORST_NET_USD_PER_CREDIT,
  floorUsd,
  limitTokens,
  llmCallUsd,
} from './cost-model';
import { PRICING } from './pricing';
import { DEEP_ANALYSIS, MODEL_DEEPSEEK_FLASH, MODEL_GEMMA, prepareProRun } from './runners';
import type { Env } from './env';
import { PRO_TEXT_LIMITS, estimateTokens } from '../../packages/core/src/lib/pro-limits';

const noAi = {
  AI: { run: () => Promise.reject(new Error('no provider in this test')) },
} as unknown as Env;

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

  it('classifies every priced tool as modelled or explicitly unbounded', () => {
    const modelled = new Set(WORST_CASES.map((c) => c.toolId));
    for (const toolId of Object.keys(PRICING)) {
      const classified = modelled.has(toolId) || toolId in UNBOUNDED_TOOLS;
      expect(classified, `${toolId} needs a WORST_CASES row or an UNBOUNDED_TOOLS reason`).toBe(
        true,
      );
      expect(modelled.has(toolId) && toolId in UNBOUNDED_TOOLS, toolId).toBe(false);
    }
  });

  it('models every tool that has text limits', () => {
    const modelled = new Set(WORST_CASES.map((c) => c.toolId));
    for (const toolId of Object.keys(PRO_TEXT_LIMITS))
      expect(modelled.has(toolId), toolId).toBe(true);
  });

  it('prices the deep-analysis fallback call on top of the primary call', () => {
    expect(DEEP_ANALYSIS.primaryModel).toBe(MODEL_DEEPSEEK_FLASH);
    expect(DEEP_ANALYSIS.fallbackModel).toBe(MODEL_GEMMA);
    const deep = WORST_CASES.find((c) => c.toolId === 'deep-analysis-pro')!;
    const primaryOnly = llmCallUsd({
      model: MODEL_DEEPSEEK_FLASH,
      inputTokens: limitTokens('deep-analysis-pro'),
      maxOutputTokens: DEEP_ANALYSIS.maxOutputTokens,
    });
    expect(deep.usd).toBeGreaterThan(primaryOnly);
  });
});

describe('token estimate is conservative for non-English text', () => {
  it('counts ASCII at 1 per 3 chars and every non-ASCII code unit as a token', () => {
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('a'.repeat(100_000))).toBe(33_334);
    expect(estimateTokens('漢字かな한글')).toBe(6);
    expect(estimateTokens('😀')).toBe(2);
  });

  // The cost model prices caps in estimated tokens; these prove the server
  // actually refuses the all-CJK and all-emoji inputs just over each cap,
  // and accepts the same cap in English.
  const cases = Object.entries(PRO_TEXT_LIMITS).flatMap(([toolId, fields]) =>
    Object.entries(fields).map(([field, max]) => [toolId, field, max] as const),
  );
  const baseInput = (toolId: string): Record<string, unknown> => ({
    text: 'x',
    question: 'q',
    description: 'd',
    image:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    imageBase64:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    ...(toolId === 'json-extract-pro' ? { schema: 's' } : {}),
  });

  it.each(cases)(
    '%s.%s refuses CJK and emoji over the cap before provider work',
    (toolId, field, max) => {
      expect(() =>
        prepareProRun(toolId, { ...baseInput(toolId), [field]: '漢'.repeat(max + 1) }, noAi),
      ).toThrow('too long');
      expect(() =>
        prepareProRun(
          toolId,
          { ...baseInput(toolId), [field]: '😀'.repeat(Math.floor(max / 2) + 1) },
          noAi,
        ),
      ).toThrow('too long');
      expect(
        typeof prepareProRun(toolId, { ...baseInput(toolId), [field]: '漢'.repeat(max) }, noAi),
      ).toBe('function');
    },
  );
});
