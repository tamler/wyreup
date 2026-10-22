import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownToHtml } from '../../src/tools/markdown-to-html/index.js';
import type { ToolRunContext } from '../../src/types.js';

interface ImageCase {
  name: string;
  input: string;
  html: string;
  htmlNoGfm?: string;
}

const cases = JSON.parse(
  readFileSync(new URL('../fixtures/live4-image-alt-cases.json', import.meta.url), 'utf8'),
) as ImageCase[];

afterEach(() => vi.unstubAllGlobals());

describe.each([true, false])('LIVE4 complete original image-alt bytes, GFM=%s', (gfm) => {
  it.each(cases)('$name', async (fixture) => {
    const fetcher = vi.fn(() => {
      throw new Error('Local Markdown conversion must not fetch resources.');
    });
    vi.stubGlobal('fetch', fetcher);
    const stages: string[] = [];
    const context: ToolRunContext = {
      signal: new AbortController().signal,
      executionId: `independent-image-alt-${fixture.name}-${gfm}`,
      cache: new Map(),
      onProgress: (event) => stages.push(event.stage),
    };
    const result = await markdownToHtml.run(
      [new File([fixture.input], 'original.md', { type: 'text/markdown' })],
      { gfm },
      context,
    );
    const output = Array.isArray(result) ? result : [result];
    expect(output).toHaveLength(1);
    expect(output[0]!.type).toBe('text/html');
    expect(await output[0]!.text()).toBe(
      !gfm && fixture.htmlNoGfm ? fixture.htmlNoGfm : fixture.html,
    );
    expect(stages).toContain('done');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
