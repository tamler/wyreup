import { describe, it, expect } from 'vitest';
import { unicodeNormalize, normalizeUnicode } from '../../../src/tools/unicode-normalize/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('unicode-normalize — metadata', () => {
  it('has id unicode-normalize', () => {
    expect(unicodeNormalize.id).toBe('unicode-normalize');
  });

  it('is in the text category', () => {
    expect(unicodeNormalize.category).toBe('text');
  });

  it('defaults to NFC', () => {
    expect(unicodeNormalize.defaults.form).toBe('NFC');
  });

  it('has no installSize', () => {
    expect(unicodeNormalize.installSize).toBeUndefined();
  });

  it('outputs text/plain', () => {
    expect(unicodeNormalize.output.mime).toBe('text/plain');
  });
});

describe('normalizeUnicode helper', () => {
  // é as precomposed U+00E9 vs decomposed e + U+0301 combining acute
  const precomposed = '\u00E9'; // é (NFC)
  const decomposed = 'e\u0301'; // é decomposed (NFD)

  it('NFC converts decomposed to precomposed', () => {
    const result = normalizeUnicode(decomposed, 'NFC');
    expect(result).toBe(precomposed);
    expect(result.length).toBe(1);
  });

  it('NFD converts precomposed to decomposed', () => {
    const result = normalizeUnicode(precomposed, 'NFD');
    expect(result.length).toBe(2);
  });

  it('NFKC normalizes compatibility equivalents', () => {
    // fi ligature (U+FB01) should normalize to "fi"
    const ligature = '\uFB01';
    const result = normalizeUnicode(ligature, 'NFKC');
    expect(result).toBe('fi');
  });

  it('identity on already-normalized ASCII', () => {
    const ascii = 'Hello, world!';
    expect(normalizeUnicode(ascii, 'NFC')).toBe(ascii);
    expect(normalizeUnicode(ascii, 'NFD')).toBe(ascii);
  });
});

describe('unicode-normalize — run()', () => {
  it('returns text/plain blob', async () => {
    const input = new File(['hello'], 'test.txt', { type: 'text/plain' });
    const [out] = await unicodeNormalize.run([input], { form: 'NFC' }, makeCtx()) as Blob[];
    expect(out!.type).toBe('text/plain');
  });

  it('NFC round-trips plain ASCII', async () => {
    const text = 'The quick brown fox';
    const input = new File([text], 'ascii.txt', { type: 'text/plain' });
    const [out] = await unicodeNormalize.run([input], { form: 'NFC' }, makeCtx()) as Blob[];
    expect(await out!.text()).toBe(text);
  });

  it('NFD decomposes precomposed characters', async () => {
    const text = '\u00E9'; // é precomposed
    const input = new File([text], 'e.txt', { type: 'text/plain' });
    const [out] = await unicodeNormalize.run([input], { form: 'NFD' }, makeCtx()) as Blob[];
    const result = await out!.text();
    expect(result.length).toBe(2);
  });

  it('NFKC normalizes fi ligature', async () => {
    const input = new File(['\uFB01'], 'fi.txt', { type: 'text/plain' });
    const [out] = await unicodeNormalize.run([input], { form: 'NFKC' }, makeCtx()) as Blob[];
    expect(await out!.text()).toBe('fi');
  });

  it('rejects invalid form', async () => {
    const input = new File(['hello'], 'test.txt', { type: 'text/plain' });
    await expect(
      unicodeNormalize.run([input], { form: 'INVALID' as 'NFC' }, makeCtx()),
    ).rejects.toThrow();
  });

  it('rejects with 0 files', async () => {
    await expect(unicodeNormalize.run([], {}, makeCtx())).rejects.toThrow();
  });
});
