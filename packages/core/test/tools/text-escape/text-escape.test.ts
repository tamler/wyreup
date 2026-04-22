import { describe, it, expect } from 'vitest';
import {
  textEscape,
  encodeHtml,
  decodeHtml,
  encodeUnicode,
  decodeUnicode,
} from '../../../src/tools/text-escape/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

describe('text-escape — metadata', () => {
  it('has id text-escape', () => {
    expect(textEscape.id).toBe('text-escape');
  });

  it('is in the dev category', () => {
    expect(textEscape.category).toBe('dev');
  });

  it('defaults to encode-html', () => {
    expect(textEscape.defaults.mode).toBe('encode-html');
  });

  it('has no installSize', () => {
    expect(textEscape.installSize).toBeUndefined();
  });

  it('outputs text/plain', () => {
    expect(textEscape.output.mime).toBe('text/plain');
  });
});

describe('encodeHtml', () => {
  it('encodes & to &amp;', () => {
    expect(encodeHtml('a & b')).toBe('a &amp; b');
  });

  it('encodes < and > to entities', () => {
    expect(encodeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('encodes double quotes', () => {
    expect(encodeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('encodes single quotes', () => {
    expect(encodeHtml("it's")).toBe('it&#39;s');
  });

  it('leaves plain text unchanged', () => {
    expect(encodeHtml('hello world')).toBe('hello world');
  });
});

describe('decodeHtml', () => {
  it('decodes &amp; to &', () => {
    expect(decodeHtml('a &amp; b')).toBe('a & b');
  });

  it('decodes &lt; and &gt;', () => {
    expect(decodeHtml('&lt;div&gt;')).toBe('<div>');
  });

  it('decodes &quot;', () => {
    expect(decodeHtml('&quot;hello&quot;')).toBe('"hello"');
  });

  it('decodes numeric decimal entities', () => {
    expect(decodeHtml('&#65;')).toBe('A');
  });

  it('decodes numeric hex entities', () => {
    expect(decodeHtml('&#x41;')).toBe('A');
  });

  it('roundtrips with encodeHtml', () => {
    const original = '<script>alert("xss & stuff")</script>';
    expect(decodeHtml(encodeHtml(original))).toBe(original);
  });
});

describe('encodeUnicode / decodeUnicode', () => {
  it('encodes non-ASCII characters', () => {
    const result = encodeUnicode('\u00E9'); // é
    expect(result).toContain('\\u');
  });

  it('leaves ASCII printable chars unchanged', () => {
    expect(encodeUnicode('hello')).toBe('hello');
  });

  it('decodes \\uXXXX sequences', () => {
    expect(decodeUnicode('\\u0041')).toBe('A');
  });

  it('decodes \\u{XXXXXX} sequences', () => {
    expect(decodeUnicode('\\u{1F600}')).toBe('\u{1F600}');
  });

  it('roundtrips through encode/decode', () => {
    const original = 'caf\u00E9';
    expect(decodeUnicode(encodeUnicode(original))).toBe(original);
  });
});

describe('text-escape — run()', () => {
  it('encode-html mode produces correct output', async () => {
    const input = new File(['<b>Hello & World</b>'], 'html.txt', { type: 'text/plain' });
    const [out] = await textEscape.run([input], { mode: 'encode-html' }, makeCtx()) as Blob[];
    const text = await out!.text();
    expect(text).toBe('&lt;b&gt;Hello &amp; World&lt;/b&gt;');
  });

  it('decode-html mode decodes entities', async () => {
    const input = new File(['&lt;b&gt;Hello&lt;/b&gt;'], 'html.txt', { type: 'text/plain' });
    const [out] = await textEscape.run([input], { mode: 'decode-html' }, makeCtx()) as Blob[];
    const text = await out!.text();
    expect(text).toBe('<b>Hello</b>');
  });

  it('encode-unicode mode encodes non-ASCII', async () => {
    const input = new File(['\u00E9'], 'unicode.txt', { type: 'text/plain' });
    const [out] = await textEscape.run([input], { mode: 'encode-unicode' }, makeCtx()) as Blob[];
    const text = await out!.text();
    expect(text).toContain('\\u');
  });

  it('decode-unicode mode decodes escape sequences', async () => {
    const input = new File(['\\u0048\\u0065\\u006C\\u006C\\u006F'], 'uni.txt', { type: 'text/plain' });
    const [out] = await textEscape.run([input], { mode: 'decode-unicode' }, makeCtx()) as Blob[];
    const text = await out!.text();
    expect(text).toBe('Hello');
  });

  it('rejects invalid mode', async () => {
    const input = new File(['hello'], 'test.txt', { type: 'text/plain' });
    await expect(
      textEscape.run([input], { mode: 'invalid' as 'encode-html' }, makeCtx()),
    ).rejects.toThrow();
  });

  it('rejects with 0 files', async () => {
    await expect(textEscape.run([], {}, makeCtx())).rejects.toThrow();
  });
});
