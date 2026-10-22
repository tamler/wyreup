import { describe, expect, it } from 'vitest';
import {
  convertUtf8Bytes,
  numberBaseConverter,
} from '../../../src/tools/number-base-converter/index';
import type {
  NumberBaseConverterParams,
  NumberBaseResult,
} from '../../../src/tools/number-base-converter/index';
import type { ToolRunContext } from '../../../src/types';
const ctx = (): ToolRunContext => ({
  onProgress() {},
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'number-base-extension',
});
async function run(text: string, params: NumberBaseConverterParams = {}) {
  const output = await numberBaseConverter.run(
    [new File([text], 'input.txt', { type: 'text/plain' })],
    params,
    ctx(),
  );
  return (Array.isArray(output) ? output[0] : output)!;
}
describe('independent signed nondecimal regressions', () => {
  it.each(['--255', '-+255'])('rejects malformed double signs %s', async (text) => {
    await expect(run(text, { inputBase: 10 })).rejects.toThrow('integer sign');
  });
  it.each([
    ['-0xFF', 'auto', '-255'],
    ['-0b1010', 'auto', '-10'],
    ['-0o10', 'auto', '-8'],
    ['-FF', 16, '-255'],
    ['-1010', 2, '-10'],
    ['-10', 8, '-8'],
    ['-255', 10, '-255'],
  ] as const)(
    'converts signed %s without passing a signed radix prefix to BigInt',
    async (value, inputBase, decimal) => {
      const result = JSON.parse(await (await run(value, { inputBase })).text()) as NumberBaseResult;
      expect(result.decimal).toBe(decimal);
      expect(result.binary.startsWith('-')).toBe(true);
      expect(result.hexadecimal.startsWith('-')).toBe(true);
    },
  );
  it('retains the unprefixed autodetection contract', async () => {
    const decimal = async (text: string) =>
      (JSON.parse(await (await run(text)).text()) as NumberBaseResult).decimal;
    expect(await decimal('10')).toBe('2');
    expect(await decimal('77')).toBe('63');
    expect(await decimal('FF')).toBe('255');
    expect(await decimal('99')).toBe('99');
  });
});
describe('UTF-8 byte conversion', () => {
  it.each([
    ['binary', '11000011 10101001'],
    ['hex', 'c3 a9'],
    ['decimal', '195 169'],
  ] as const)('encodes and decodes known Unicode bytes in %s', async (byteFormat, bytes) => {
    const encoded = await run('é', { conversionKind: 'utf8-bytes', byteFormat });
    expect(encoded.type).toBe('text/plain');
    expect(await encoded.text()).toBe(bytes);
    expect(
      await (
        await run(bytes, { conversionKind: 'utf8-bytes', direction: 'decode', byteFormat })
      ).text(),
    ).toBe('é');
  });
  it('preserves whitespace, BOM and empty strings', async () => {
    expect(convertUtf8Bytes(' ', 'encode', 'binary')).toBe('00100000');
    expect(convertUtf8Bytes(' ', 'encode', 'hex')).toBe('20');
    expect(convertUtf8Bytes(' ', 'encode', 'decimal')).toBe('32');
    expect(convertUtf8Bytes('\ufeff\n', 'encode', 'hex')).toBe('ef bb bf 0a');
    expect(convertUtf8Bytes('ef bb bf 0a', 'decode', 'hex')).toBe('\ufeff\n');
    expect(convertUtf8Bytes('  C3  A9  ', 'decode', 'hex')).toBe('é');
    expect(await (await run('', { conversionKind: 'utf8-bytes' })).text()).toBe('');
    expect(convertUtf8Bytes('', 'decode', 'binary')).toBe('');
  });
  it.each(['\ud800', '\udc00', 'a\ud800b'])(
    'rejects lone surrogates in original strings',
    (value) => {
      expect(() => convertUtf8Bytes(value, 'encode', 'hex')).toThrow('Unpaired UTF-16 surrogate');
    },
  );
  it.each([
    ['hex', 'c3'],
    ['hex', 'c0 af'],
    ['hex', 'ed a0 80'],
    ['binary', '101'],
    ['hex', 'c3a9'],
    ['hex', 'c3\ta9'],
    ['decimal', '256'],
    ['decimal', '1e2'],
    ['decimal', '-1'],
    ['decimal', '01'],
  ] as const)('rejects invalid %s bytes %s', (format, bytes) => {
    expect(() => convertUtf8Bytes(bytes, 'decode', format)).toThrow();
  });
  it('retains exact numeric JSON formatting and truthful mode MIME', async () => {
    const output = await run('255', { inputBase: 10 });
    expect(output.type).toBe('application/json');
    expect(await output.text()).toBe(
      '{\n  "decimal": "255",\n  "binary": "11111111",\n  "octal": "377",\n  "hexadecimal": "FF",\n  "binaryPadded": "11111111",\n  "hexPadded": "FF"\n}',
    );
    expect(numberBaseConverter.output.mime).toBe('*/*');
    expect(numberBaseConverter.__testFixtures?.expectedOutputMime).toEqual([
      'application/json',
      'text/plain',
    ]);
    expect(Object.keys(numberBaseConverter.paramSchema!)[0]).toBe('conversionKind');
  });
  it('rejects file size, malformed UTF-8 input, invalid parameters and cancellation', async () => {
    await expect(
      run('a'.repeat(1024 * 1024 + 1), { conversionKind: 'utf8-bytes' }),
    ).rejects.toThrow('1 MiB');
    await expect(
      numberBaseConverter.run(
        [new File([new Uint8Array([0xc3])], 'invalid.txt')],
        { conversionKind: 'utf8-bytes' },
        ctx(),
      ),
    ).rejects.toThrow('valid UTF-8');
    expect(() => convertUtf8Bytes('x', 'other' as 'encode', 'hex')).toThrow('direction');
    const controller = new AbortController();
    controller.abort();
    await expect(
      numberBaseConverter.run(
        [new File(['x'], 'x.txt')],
        {},
        { ...ctx(), signal: controller.signal },
      ),
    ).rejects.toThrow('Aborted');
  });
});
