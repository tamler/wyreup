import { describe, expect, it } from 'vitest';
import {
  CHARS_PER_TOKEN,
  WORST_CASES,
  WORST_NET_USD_PER_CREDIT,
  floorUsd,
  llmCallUsd,
} from './cost-model';
import { DEEP_ANALYSIS, FIX_GRAMMAR, MODEL_DEEPSEEK_FLASH, MODEL_GEMMA } from './runners';

describe('Pro cost model', () => {
  it('uses the approved worst-case revenue per credit', () => {
    expect(WORST_NET_USD_PER_CREDIT).toBeCloseTo(0.016136, 6);
    expect(CHARS_PER_TOKEN).toBeLessThanOrEqual(3);
  });

  it.each(WORST_CASES.map((c) => [c.toolId, c]))(
    '%s worst-case Cloudflare cost is at most 50% of worst-case net revenue',
    (_id, c) => {
      expect(c.usd, c.detail).toBeGreaterThan(0);
      expect(c.usd, c.detail).toBeLessThanOrEqual(floorUsd(c.toolId));
    },
  );

  it('covers the tools moved off retiring models', () => {
    const ids = WORST_CASES.map((c) => c.toolId);
    expect(ids).toEqual(
      expect.arrayContaining(['text-to-speech-pro', 'deep-analysis-pro', 'fix-grammar-pro']),
    );
  });

  it('prices the deep-analysis fallback call on top of the primary call', () => {
    expect(DEEP_ANALYSIS.primaryModel).toBe(MODEL_DEEPSEEK_FLASH);
    expect(DEEP_ANALYSIS.fallbackModel).toBe(MODEL_GEMMA);
    const deep = WORST_CASES.find((c) => c.toolId === 'deep-analysis-pro')!;
    const primaryOnly = llmCallUsd({
      model: MODEL_DEEPSEEK_FLASH,
      inputChars: 100_000,
      maxOutputTokens: DEEP_ANALYSIS.maxOutputTokens,
    });
    expect(deep.usd).toBeGreaterThan(primaryOnly);
  });

  it('pins the current numbers so a repricing is a deliberate edit', () => {
    const usd = Object.fromEntries(WORST_CASES.map((c) => [c.toolId, c.usd]));
    expect(usd['text-to-speech-pro']).toBeCloseTo(0.015, 6);
    expect(usd['deep-analysis-pro']).toBeLessThan(0.0235);
    expect(usd['fix-grammar-pro']).toBeLessThan(0.0025);
    expect(FIX_GRAMMAR.maxChars).toBe(12_000);
  });
});
