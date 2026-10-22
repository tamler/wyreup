import { expect, it } from 'vitest';
import { numberBaseConverter } from '../../../src/tools/number-base-converter/index.js';

it('rejects more than one integer sign before magnitude parsing', async () => {
  const context = {
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'sign-test',
    onProgress() {},
  };
  for (const text of ['-+255', '--255', '+-255', '++255']) {
    await expect(
      numberBaseConverter.run(
        [new File([text], 'number.txt', { type: 'text/plain' })],
        { inputBase: 10 },
        context,
      ),
    ).rejects.toThrow();
  }
});
