import { describe, expect, it } from 'vitest';
import type { ToolRunContext } from '../../../src/types.js';
import {
  numberBaseConverter,
  type NumberBaseConverterParams,
  type NumberBaseResult,
} from '../../../src/tools/number-base-converter/index.js';

const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'independent-numeric-source-regressions',
  onProgress() {},
});
async function convert(text: string, params: NumberBaseConverterParams = {}) {
  const result = await numberBaseConverter.run(
    [new File([text], 'number.txt', { type: 'text/plain' })],
    params,
    context(),
  );
  const artifacts = Array.isArray(result) ? result : [result];
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]!.type).toBe('application/json');
  return JSON.parse(await artifacts[0]!.text()) as NumberBaseResult;
}

describe('independent explicit-base prefix interpretation', () => {
  it('treats 0b10 as hexadecimal digits when base 16 is explicitly selected', async () => {
    // B*16^2 + 1*16 = 11*256 + 16 = 2832, not binary 2 or hex 16.
    expect(await convert('0b10', { inputBase: 16 })).toEqual({
      decimal: '2832',
      binary: '101100010000',
      octal: '5420',
      hexadecimal: 'B10',
      binaryPadded: '0000101100010000',
      hexPadded: '0B10',
    });
  });
  it('applies the minus after explicit hexadecimal magnitude parsing', async () => {
    expect(await convert('-0b10', { inputBase: 16 })).toEqual({
      decimal: '-2832',
      binary: '-101100010000',
      octal: '-5420',
      hexadecimal: '-B10',
      binaryPadded: '-0000101100010000',
      hexPadded: '-0B10',
    });
  });
  it.each([
    [10, '0b10'],
    [10, '0x10'],
    [10, '0o10'],
    [8, '0x10'],
    [8, '0b10'],
    [2, '0o10'],
    [2, '0x10'],
  ] as const)('rejects mismatched prefix %s / %s', async (inputBase, text) => {
    await expect(convert(text, { inputBase })).rejects.toThrow(/invalid.*base|digit/i);
    await expect(convert(`-${text}`, { inputBase })).rejects.toThrow(/invalid.*base|digit/i);
  });
  it.each([
    [2, '0b1010', '10'],
    [2, '0B1010', '10'],
    [8, '0o17', '15'],
    [8, '0O17', '15'],
    [16, '0xFF', '255'],
    [16, '0XFF', '255'],
  ] as const)('retains matching prefixes for base %s / %s', async (inputBase, text, expected) => {
    expect((await convert(text, { inputBase })).decimal).toBe(expected);
    expect((await convert(`-${text}`, { inputBase })).decimal).toBe(`-${expected}`);
  });
});

describe('independent numeric grammar and legacy controls', () => {
  it.each(['- 255', '-\t255', '-\n255', '+ 255', '+\t255', '+\n255'])(
    'rejects internal sign whitespace %j',
    async (text) => {
      await expect(convert(text, { inputBase: 10 })).rejects.toThrow(/whitespace|invalid|sign/i);
    },
  );
  it('rejects internal sign whitespace in auto mode too', async () => {
    await expect(convert('- 10', { inputBase: 'auto' })).rejects.toThrow(
      /whitespace|invalid|sign/i,
    );
  });
  it('reports unsupported base distinctly for direct callers', async () => {
    const unsupported = { inputBase: 4 } as unknown as NumberBaseConverterParams;
    await expect(convert('10', unsupported)).rejects.toThrow(/unsupported base/i);
  });
  it('preserves auto plus-decimal and unprefixed binary heuristics', async () => {
    expect((await convert('+10', { inputBase: 'auto' })).decimal).toBe('10');
    expect((await convert('10', { inputBase: 'auto' })).decimal).toBe('2');
    expect((await convert('10')).decimal).toBe('2');
    expect((await convert('-10', { inputBase: 'auto' })).decimal).toBe('-2');
    expect((await convert('-0xFF', { inputBase: 'auto' })).decimal).toBe('-255');
    expect((await convert('-0b1010', { inputBase: 'auto' })).decimal).toBe('-10');
  });
  it('retains exterior trimming, negative output fields and sign-free padding', async () => {
    expect(await convert(' \t-255\n', { inputBase: 10 })).toEqual({
      decimal: '-255',
      binary: '-11111111',
      octal: '-377',
      hexadecimal: '-FF',
      binaryPadded: '-11111111',
      hexPadded: '-FF',
    });
  });
});
