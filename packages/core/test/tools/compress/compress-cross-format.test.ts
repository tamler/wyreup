import { describe, expect, it } from 'vitest';
import { compress } from '../../../src/tools/compress/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(messages: Array<string | undefined>): ToolRunContext {
  return {
    onProgress: (p) => messages.push(p.message),
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'compress-cross-format',
  };
}

describe('compress format-aware inflation guard', () => {
  it('preserves a requested JPEG conversion and warns if it inflates', async () => {
    const messages: Array<string | undefined> = [];
    const input = loadFixture('graphic.png', 'image/png');
    const result = await compress.run(
      [input],
      { quality: 80, targetFormat: 'jpeg' },
      makeCtx(messages),
    );
    const output = Array.isArray(result) ? result[0]! : result;

    expect(output.type).toBe('image/jpeg');
    expect(
      output.size <= input.size ||
        messages.some((message) =>
          /larger than the original — format change was requested/.test(message ?? ''),
        ),
    ).toBe(true);
  });

  it('never inflates a same-format PNG', async () => {
    const messages: Array<string | undefined> = [];
    const input = loadFixture('graphic.png', 'image/png');
    const result = await compress.run([input], { quality: 100 }, makeCtx(messages));
    const output = Array.isArray(result) ? result[0]! : result;

    expect(output.size).toBeLessThanOrEqual(input.size);
    if (messages.some((message) => message?.includes('keeping the original'))) {
      expect(new Uint8Array(await output.arrayBuffer())).toEqual(
        new Uint8Array(await input.arrayBuffer()),
      );
    }
  });
});
