import { describe, expect, it, vi } from 'vitest';
import {
  PROMPT_OVERHEAD_TOKENS,
  TEMPLATE_TOKENS,
  UNBOUNDED_TOOLS,
  WORST_CASES,
  WORST_NET_USD_PER_CREDIT,
  floorUsd,
  limitTokens,
  llmCallUsd,
} from './cost-model';
import { PRICING } from './pricing';
import { DEEP_ANALYSIS, MODEL_DEEPSEEK_FLASH, MODEL_GEMMA, prepareProRun, runPro } from './runners';
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

describe('token bound is the UTF-8 byte count', () => {
  it('counts bytes, taking the larger of raw and NFKC forms', () => {
    expect(estimateTokens('abc')).toBe(3);
    expect(estimateTokens('1 '.repeat(50_000))).toBe(100_000);
    expect(estimateTokens('龘'.repeat(34_000))).toBe(102_000);
    expect(estimateTokens('😀')).toBe(4);
    // U+FDFA expands to 18 Arabic letters and spaces under NFKC.
    expect(estimateTokens('ﷺ')).toBe('ﷺ'.normalize('NFKC').length > 1 ? 33 : 3);
  });

  // The cost model prices caps in bytes; these prove the server refuses the
  // review's adversarial inputs just over each cap and accepts inputs at it.
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
    target: toolId === 'translate-indic-pro' ? 'hin_Deva' : 'fr',
    ...(toolId === 'json-extract-pro' ? { schema: 's' } : {}),
  });

  const prep = (toolId: string, field: string, value: string) =>
    prepareProRun(toolId, { ...baseInput(toolId), [field]: value }, noAi);

  it.each(cases)(
    '%s.%s refuses digits, rare CJK and emoji over the cap before provider work',
    (toolId, field, max) => {
      const digits = '1 '.repeat(Math.ceil((max + 1) / 2));
      expect(() => prep(toolId, field, digits)).toThrow('too long');
      expect(() => prep(toolId, field, '龘'.repeat(Math.floor(max / 3) + 1))).toThrow('too long');
      expect(() => prep(toolId, field, '😀'.repeat(Math.floor(max / 4) + 1))).toThrow('too long');
      const atCap = Math.min(max, 100_000);
      expect(typeof prep(toolId, field, 'a'.repeat(atCap))).toBe('function');
      expect(typeof prep(toolId, field, '龘'.repeat(Math.floor(max / 3)))).toBe('function');
    },
  );
});

describe('prompt overhead covers every real system prompt and wrapper', () => {
  // Run each text and vision runner with one-character inputs, capture
  // what it actually sends, and check the bytes beyond the user's fields
  // fit the per-call overhead the cost model assumes.
  const universal = {
    response: '{"entities":[],"pattern":"a","flags":"","cron":"* * * * *","explanation":"e"}',
    choices: [{ message: { role: 'assistant', content: '{"a":1}' }, finish_reason: 'stop' }],
  };
  const toolIds = [
    ...Object.keys(PRO_TEXT_LIMITS),
    'ocr-hq',
    'image-describe',
    'analyze-chart',
    'read-handwriting',
    'translate-image',
  ];
  it.each(toolIds)('%s', async (toolId) => {
    const sent: string[] = [];
    const run = vi.fn((_model: string, input: Record<string, unknown>) => {
      const messages = (input.messages ?? []) as { content: string }[];
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';
      sent.push(messages.map((m) => m.content).join('') + prompt);
      return Promise.resolve(universal);
    });
    const env = { AI: { run } } as unknown as Env;
    await runPro(
      toolId,
      {
        text: 'x',
        question: 'q',
        description: 'd',
        schema: 's',
        imageBase64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        target: toolId === 'translate-indic-pro' ? 'hin_Deva' : 'fr',
        source: 'en',
      },
      env,
    ).catch(() => {});
    expect(sent.length, toolId).toBeGreaterThan(0);
    for (const text of sent) {
      expect(estimateTokens(text), toolId).toBeLessThanOrEqual(
        PROMPT_OVERHEAD_TOKENS - TEMPLATE_TOKENS,
      );
    }
  });
});
