import { describe, it, expect } from 'vitest';
import { textStatsByParagraph } from '../../../src/tools/text-stats-by-paragraph/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('text-stats-by-paragraph — run()', () => {
  it('counts a pathological punctuation-free paragraph in under one second', async () => {
    const input = new File(['a'.repeat(100_000)], 'text.txt', { type: 'text/plain' });
    const start = performance.now();
    const [output] = (await textStatsByParagraph.run(
      [input],
      { minWordsForReadability: 200 },
      makeCtx(),
    )) as Blob[];
    const result = JSON.parse(await output!.text()) as { paragraphs: Array<{ sentences: number }> };

    expect(result.paragraphs[0]?.sentences).toBe(1);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
