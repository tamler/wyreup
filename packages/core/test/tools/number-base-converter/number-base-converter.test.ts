import { describe, it, expect } from 'vitest';
import { numberBaseConverter } from '../../../src/tools/number-base-converter/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { NumberBaseResult } from '../../../src/tools/number-base-converter/index.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(text: string, inputBase?: number | 'auto'): Promise<NumberBaseResult> {
  const file = new File([text], 'input.txt', { type: 'text/plain' });
  const [out] = await numberBaseConverter.run(
    [file],
    { inputBase: inputBase as never },
    makeCtx(),
  ) as Blob[];
  return JSON.parse(await out!.text()) as NumberBaseResult;
}

describe('number-base-converter — metadata', () => {
  it('has id number-base-converter', () => {
    expect(numberBaseConverter.id).toBe('number-base-converter');
  });

  it('is in the dev category', () => {
    expect(numberBaseConverter.category).toBe('dev');
  });

  it('outputs application/json', () => {
    expect(numberBaseConverter.output.mime).toBe('application/json');
  });
});

describe('number-base-converter — run()', () => {
  it('converts decimal 255 to all bases', async () => {
    const result = await run('255', 10);
    expect(result.decimal).toBe('255');
    expect(result.binary).toBe('11111111');
    expect(result.octal).toBe('377');
    expect(result.hexadecimal).toBe('FF');
  });

  it('converts hex FF auto-detected', async () => {
    const result = await run('FF', 'auto');
    expect(result.decimal).toBe('255');
  });

  it('converts binary 1010 to decimal 10', async () => {
    const result = await run('1010', 2);
    expect(result.decimal).toBe('10');
  });

  it('handles 0x prefix for hex', async () => {
    const result = await run('0xFF', 'auto');
    expect(result.decimal).toBe('255');
  });

  it('pads binary to 8-bit boundary', async () => {
    const result = await run('255', 10);
    expect(result.binaryPadded.length % 8).toBe(0);
  });

  it('pads hex to 2-char boundary', async () => {
    const result = await run('255', 10);
    expect(result.hexPadded.length % 2).toBe(0);
  });

  it('handles large numbers via BigInt', async () => {
    const result = await run('9999999999999999999', 10);
    expect(result.decimal).toBe('9999999999999999999');
  });

  it('throws on empty input', async () => {
    const file = new File([''], 'input.txt', { type: 'text/plain' });
    await expect(
      numberBaseConverter.run([file], {}, makeCtx()),
    ).rejects.toThrow('empty');
  });
});
