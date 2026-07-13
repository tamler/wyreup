import { describe, expect, it } from 'vitest';
import { compressImageToSize } from '../../../src/tools/compress-image-to-size/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import { loadFixture } from '../../lib/load-fixture.js';

function makeCtx(messages: Array<string | undefined>): ToolRunContext {
  return {
    onProgress: (p) => messages.push(p.message),
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'compress-image-to-size-guard',
  };
}

describe('compress-image-to-size inflation guard', () => {
  it('never returns a larger result when targeting 10 KB', async () => {
    const messages: Array<string | undefined> = [];
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const result = await compressImageToSize.run(
      [input],
      { targetKb: 10 },
      makeCtx(messages),
    );
    const output = Array.isArray(result) ? result[0]! : result;

    expect(output.size).toBeLessThanOrEqual(input.size);
    if (messages.some((message) => message?.includes('keeping the original'))) {
      expect(new Uint8Array(await output.arrayBuffer())).toEqual(
        new Uint8Array(await input.arrayBuffer()),
      );
    }
  });

  it('passes through an input already under the target byte-for-byte', async () => {
    const messages: Array<string | undefined> = [];
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const result = await compressImageToSize.run(
      [input],
      { targetKb: 10000 },
      makeCtx(messages),
    );
    const output = Array.isArray(result) ? result[0]! : result;

    expect(new Uint8Array(await output.arrayBuffer())).toEqual(
      new Uint8Array(await input.arrayBuffer()),
    );
  });
});
