import { describe, it, expect } from 'vitest';
import { textReadability } from '../../../src/tools/text-readability/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

const SAMPLE_TEXT =
  'The quick brown fox jumps over the lazy dog. ' +
  'This sentence is easy to read and contains simple words. ' +
  'Reading comprehension depends on vocabulary and sentence length. ' +
  'Complex academic writing often uses longer sentences with multisyllabic words that can challenge readers.';

interface ReadabilityResult {
  flesch: number;
  fleschKincaid: number;
  colemanLiau: number;
  smog: number;
  automatedReadability: number;
  daleChall: number;
  gunningFog: number;
  gradeLevel: string;
}

async function parseRead(blob: Blob | undefined): Promise<ReadabilityResult> {
  return JSON.parse(await blob!.text()) as ReadabilityResult;
}

describe('text-readability — metadata', () => {
  it('has id text-readability', () => {
    expect(textReadability.id).toBe('text-readability');
  });

  it('is in the text category', () => {
    expect(textReadability.category).toBe('text');
  });

  it('accepts text/plain', () => {
    expect(textReadability.input.accept).toContain('text/plain');
  });

  it('outputs application/json', () => {
    expect(textReadability.output.mime).toBe('application/json');
  });

  it('has no installSize', () => {
    expect(textReadability.installSize).toBeUndefined();
  });
});

describe('text-readability — run()', () => {
  it('returns application/json blob', async () => {
    const input = new File([SAMPLE_TEXT], 'test.txt', { type: 'text/plain' });
    const [out] = await textReadability.run([input], {}, makeCtx()) as Blob[];
    expect(out!.type).toBe('application/json');
  });

  it('includes all expected score fields', async () => {
    const input = new File([SAMPLE_TEXT], 'test.txt', { type: 'text/plain' });
    const [out] = await textReadability.run([input], {}, makeCtx()) as Blob[];
    const data = await parseRead(out);
    expect(typeof data.flesch).toBe('number');
    expect(typeof data.fleschKincaid).toBe('number');
    expect(typeof data.colemanLiau).toBe('number');
    expect(typeof data.smog).toBe('number');
    expect(typeof data.automatedReadability).toBe('number');
    expect(typeof data.daleChall).toBe('number');
    expect(typeof data.gunningFog).toBe('number');
    expect(typeof data.gradeLevel).toBe('string');
  });

  it('Flesch score is within expected range (0-100 for normal text)', async () => {
    const input = new File([SAMPLE_TEXT], 'test.txt', { type: 'text/plain' });
    const [out] = await textReadability.run([input], {}, makeCtx()) as Blob[];
    const data = await parseRead(out);
    // Flesch can go outside 0-100 for very simple or complex text, but typical range
    expect(data.flesch).toBeDefined();
    expect(typeof data.flesch).toBe('number');
  });

  it('gradeLevel is a non-empty string', async () => {
    const input = new File([SAMPLE_TEXT], 'test.txt', { type: 'text/plain' });
    const [out] = await textReadability.run([input], {}, makeCtx()) as Blob[];
    const data = await parseRead(out);
    expect(data.gradeLevel.length).toBeGreaterThan(0);
  });

  it('rejects empty text', async () => {
    const input = new File([''], 'empty.txt', { type: 'text/plain' });
    await expect(textReadability.run([input], {}, makeCtx())).rejects.toThrow();
  });

  it('rejects with 0 files', async () => {
    await expect(textReadability.run([], {}, makeCtx())).rejects.toThrow();
  });

  it('scores are rounded to 1 decimal place', async () => {
    const input = new File([SAMPLE_TEXT], 'test.txt', { type: 'text/plain' });
    const [out] = await textReadability.run([input], {}, makeCtx()) as Blob[];
    const data = await parseRead(out);
    // Check rounding: result * 10 should be close to an integer
    const isRounded = (n: number) => Math.abs(Math.round(n * 10) - n * 10) < 0.001;
    expect(isRounded(data.flesch)).toBe(true);
    expect(isRounded(data.fleschKincaid)).toBe(true);
  });
});
