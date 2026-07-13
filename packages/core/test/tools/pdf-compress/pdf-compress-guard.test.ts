import { describe, expect, it } from 'vitest';
import { pdfCompress } from '../../../src/tools/pdf-compress/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(messages: Array<string | undefined>): ToolRunContext {
  return {
    onProgress: (p) => messages.push(p.message),
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'pdf-compress-guard',
  };
}

describe('pdf-compress inflation guard', () => {
  it('never inflates a minimal PDF', async () => {
    const messages: Array<string | undefined> = [];
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const result = await pdfCompress.run([input], {}, makeCtx(messages));
    const output = Array.isArray(result) ? result[0]! : result;

    expect(output.size).toBeLessThanOrEqual(input.size);
    expect(output.type).toBe('application/pdf');

    if (messages.some((message) => message?.includes('keeping the original'))) {
      expect(new Uint8Array(await output.arrayBuffer())).toEqual(
        new Uint8Array(await input.arrayBuffer()),
      );
    }
  });
});
