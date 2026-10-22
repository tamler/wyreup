import { describe, expect, it } from 'vitest';
import {
  assertUnicode,
  bulkMetaDescriptions,
  cspHeader,
  hreflangTags,
  markdownTable,
  nginxRedirects,
  parseTextRows,
  removeDuplicateLines,
  robotsText,
  textDeveloperTools,
} from '../../src/utilities/text-developer.js';
import type { ToolRunContext } from '../../src/types.js';

const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  executionId: 'text-fixture',
  cache: new Map(),
  onProgress() {},
});
const byId = (id: string) => {
  const tool = textDeveloperTools.find((tool) => tool.id === id);
  if (!tool) throw new Error(`Missing fixture tool ${id}`);
  return tool;
};
async function output(
  id: string,
  params: Record<string, unknown> = {},
  input?: string | File,
  ctx = context(),
) {
  const tool = byId(id);
  const inputs =
    input === undefined
      ? []
      : [
          typeof input === 'string'
            ? new File([input], 'fixture.txt', { type: 'text/plain' })
            : input,
        ];
  const result = await tool.run(inputs, params, ctx);
  const blobs = Array.isArray(result) ? result : [result];
  expect(blobs).toHaveLength(1);
  expect(blobs[0]!.type).toBe(tool.output.mime);
  return blobs[0]!.text();
}
const json = async (
  id: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const value: unknown = JSON.parse(await output(id, params));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a JSON object result.');
  return value as Record<string, unknown>;
};
const rows = (value: unknown) => JSON.stringify(value);

describe('original text and developer tools', () => {
  it('provides exactly thirteen unique real tasks in valid categories', () => {
    expect(textDeveloperTools).toHaveLength(13);
    expect(new Set(textDeveloperTools.map((tool) => tool.id)).size).toBe(13);
    expect(textDeveloperTools.filter((tool) => tool.category === 'text')).toHaveLength(4);
    expect(textDeveloperTools.filter((tool) => tool.category === 'dev')).toHaveLength(7);
    expect(textDeveloperTools.filter((tool) => tool.category === 'design')).toHaveLength(2);
    for (const tool of textDeveloperTools)
      expect(Object.keys(tool.defaults).sort()).toEqual(Object.keys(tool.paramSchema!).sort());
  });

  it('converts decimal integers and fractions exactly through fifteen digits', async () => {
    for (const [numberText, words] of [
      ['0', 'zero'],
      ['-0', 'zero'],
      ['000', 'zero'],
      ['-42', 'minus forty-two'],
      ['1001', 'one thousand one'],
      ['1000000', 'one million'],
      ['0.05', 'zero point zero five'],
      ['1.00', 'one point zero zero'],
      [
        '999999999999999',
        'nine hundred ninety-nine trillion nine hundred ninety-nine billion nine hundred ninety-nine million nine hundred ninety-nine thousand nine hundred ninety-nine',
      ],
    ])
      expect((await json('number-to-words-converter', { numberText })).words).toBe(words);
    for (const numberText of ['1e3', '.05', '1.', ' 1', '1.0000000', '1000000000000000'])
      await expect(output('number-to-words-converter', { numberText })).rejects.toThrow();
  });

  it('uses explicit currency nouns and minor-unit exponents without rounding money', async () => {
    for (const [numberText, words] of [
      ['1.05', 'one dollar and five cents'],
      ['0.01', 'zero dollars and one cent'],
      ['-0.00', 'zero dollars and zero cents'],
      ['1.5', 'one dollar and fifty cents'],
    ]) {
      expect(
        (await json('number-to-words-converter', { mode: 'currency', numberText })).words,
      ).toBe(words);
    }
    expect(
      (
        await json('number-to-words-converter', {
          mode: 'currency',
          numberText: '0',
          exponent: 0,
          currencyLabel: 'JPY',
          majorSingular: 'yen',
          majorPlural: 'yen',
        })
      ).words,
    ).toBe('zero yen');
    await expect(
      output('number-to-words-converter', { mode: 'currency', numberText: '1.001' }),
    ).rejects.toThrow(/exponent/);
    await expect(
      output('number-to-words-converter', { mode: 'currency', exponent: 3 }),
    ).rejects.toThrow();
    await expect(
      output('number-to-words-converter', { mode: 'currency', majorPlural: '<b>' }),
    ).rejects.toThrow();
  });

  it('keeps first lines under explicit whitespace, case and blank settings', async () => {
    const text = 'i\r\nI\r\nı\r\n x \r\nx\r\n\r\n';
    expect(
      removeDuplicateLines(text, { trim: false, caseSensitive: false, blankLines: 'keep' }),
    ).toBe('i\nı\n x \nx\n');
    expect(
      removeDuplicateLines(text, { trim: true, caseSensitive: false, blankLines: 'remove' }),
    ).toBe('i\nı\nx');
    expect(await output('remove-duplicate-lines-online', {}, '')).toBe('');
    expect(await output('remove-duplicate-lines-online', {}, 'ß\nss\nß')).toBe('ß\nss');
  });

  it('writes literal escaped Markdown with quoted delimiters and newlines', async () => {
    const source = 'name,note\nA,"a|b\\c\n<script>""x""</script>"\n';
    const expected =
      '| name | note |\n| --- | --- |\n| A | a\\|b\\\\c<br>&lt;script&gt;&quot;x&quot;&lt;/script&gt; |\n';
    expect(await output('markdown-table-generator', {}, source)).toBe(expected);
    expect(markdownTable('a,b\n1', { delimiter: 'comma', hasHeader: true })).toBe(
      '| a | b |\n| --- | --- |\n| 1 |  |\n',
    );
    expect(markdownTable('x,y', { delimiter: 'comma', hasHeader: false })).toBe(
      '| Column 1 | Column 2 |\n| --- | --- |\n| x | y |\n',
    );
  });

  it('normalizes a final terminator before auto selection, preserving actual blank records in explicit mode', () => {
    expect(parseTextRows('a,b\n', 'auto')).toEqual([['a', 'b']]);
    expect(parseTextRows('a,b\n', 'comma')).toEqual([['a', 'b']]);
    expect(parseTextRows('a,b\n\n', 'comma')).toEqual([['a', 'b'], ['']]);
    expect(() => parseTextRows('a,b\n\n', 'auto')).toThrow(/explicit delimiter/);
    expect(() => parseTextRows('a,b\tc,d\n1,2\t3,4', 'auto')).toThrow(/ambiguous/);
    expect(() => parseTextRows('one\ntwo', 'auto')).toThrow();
    expect(() => parseTextRows('a,b\n"unfinished', 'comma')).toThrow(/parse/);
    expect(() => parseTextRows('', 'comma')).toThrow(/nonempty/);
    expect(() => parseTextRows('a,b\n1,2', 'comma', 1)).toThrow(/row/);
    expect(() => parseTextRows('a,b', 'comma', 10, 1)).toThrow(/column/);
  });

  it('fills only the provided description template and reports per-row empty titles', async () => {
    const result = await output(
      'bulk-meta-description-generator',
      { maxGraphemes: 20 },
      'title,topic,url\nHello,World,https://example.com/\n,Ignored,/empty',
    );
    expect(result).toBe(
      'url,title,description,graphemeCount,truncated,error\nhttps://example.com/,Hello,Hello: World,12,false,\n/empty,,,0,false,Empty title',
    );
    expect(
      bulkMetaDescriptions('title,topic,url\n👩‍💻abc,,/emoji', {
        delimiter: 'comma',
        template: '{title}',
        maxGraphemes: 2,
      }),
    ).toBe('url,title,description,graphemeCount,truncated,error\n/emoji,👩‍💻abc,👩‍💻a,2,true,');
    expect(
      bulkMetaDescriptions('title,topic,url\nHello long world,,/words', {
        delimiter: 'comma',
        template: '{title}',
        maxGraphemes: 8,
      }),
    ).toContain('/words,Hello long world,Hello,5,true,');
    for (const template of ['{madeUp}', '{title', 'title}'])
      expect(() =>
        bulkMetaDescriptions('title,topic,url\na,b,c', {
          delimiter: 'comma',
          template,
          maxGraphemes: 160,
        }),
      ).toThrow(/Template/);
    expect(() =>
      bulkMetaDescriptions('topic,title,url\na,b,c', {
        delimiter: 'comma',
        template: '{title}',
        maxGraphemes: 160,
      }),
    ).toThrow(/header/);
  });

  it('uses real conservative Terser output for ASI, regex, templates and identifiers', async () => {
    for (const [input, expected] of [
      ['function f(){return\n{x:1}}', 'function f(){return;{x:1}}'],
      ['const matcher = /a\\/b/g;', 'const matcher=/a\\/b/g;'],
      ['const message = `/* not a comment */`;', 'const message=`/* not a comment */`;'],
      [
        'function descriptiveIdentifier(inputValue) { return inputValue + 1; }',
        'function descriptiveIdentifier(inputValue){return inputValue+1}',
      ],
    ])
      expect(await output('javascript-minifier', {}, input)).toBe(expected);
    expect(await output('javascript-minifier', {}, '')).toBe('');
    expect(await output('javascript-minifier', { module: true }, 'export const value = 2;')).toBe(
      'export const value=2;',
    );
    await expect(output('javascript-minifier', {}, 'const =')).rejects.toThrow();
  });

  it('groups robots rules and rejects directive and percent-encoded injection', async () => {
    const params = {
      groupsJson: rows([
        { userAgent: '*', rule: 'Disallow', path: '/private/' },
        { userAgent: '*', rule: 'Allow', path: '/private/public/' },
        { userAgent: 'ExampleBot', rule: 'Disallow', path: '' },
      ]),
      sitemapsJson: rows([{ url: 'https://example.com/sitemap.xml' }]),
    };
    expect(await output('robots-txt-generator', params)).toBe(
      'User-agent: *\nDisallow: /private/\nAllow: /private/public/\n\nUser-agent: ExampleBot\nDisallow:\n\nSitemap: https://example.com/sitemap.xml\n',
    );
    for (const path of ['/search?q=a&x=1', '/caf%C3%A9', '/*.pdf$'])
      expect(
        robotsText({
          groupsJson: rows([{ userAgent: '*', rule: 'Allow', path }]),
          sitemapsJson: '[]',
        }),
      ).toContain(path);
    for (const path of [
      '',
      '/bad\nAllow: /',
      '/a#b',
      '/a:b',
      '/bad%',
      '/a$b',
      '/%0A',
      '/%20',
      '/%23',
      '/%3A',
      '/é',
    ])
      expect(() =>
        robotsText({
          groupsJson: rows([{ userAgent: '*', rule: 'Allow', path }]),
          sitemapsJson: '[]',
        }),
      ).toThrow();
    expect(() =>
      robotsText({
        groupsJson: rows([
          { userAgent: '*', rule: 'Allow', path: '/' },
          { userAgent: 'Bot', rule: 'Allow', path: '/' },
          { userAgent: '*', rule: 'Allow', path: '/' },
        ]),
        sitemapsJson: '[]',
      }),
    ).toThrow(/consecutive/);
  });

  it('derives all permission and special-bit forms and quotes literal filenames', async () => {
    for (const [octal, symbolic] of [
      ['0644', 'rw-r--r--'],
      ['0755', 'rwxr-xr-x'],
      ['1777', 'rwxrwxrwt'],
      ['4755', 'rwsr-xr-x'],
      ['2644', 'rw-r-Sr--'],
      ['1000', '--------T'],
    ])
      expect((await json('chmod-calculator', { mode: 'octal', octal })).symbolic).toBe(symbolic);
    expect(await json('chmod-calculator', {})).toEqual({
      octal: '0644',
      symbolic: 'rw-r--r--',
      command: "chmod 0644 -- 'data.txt'",
    });
    expect((await json('chmod-calculator', { filename: "!a'b!c $x `id`" })).command).toBe(
      "chmod 0644 -- '!a'\\''b!c $x `id`'",
    );
    await expect(output('chmod-calculator', { filename: 'a\nb' })).rejects.toThrow(/controls/);
    await expect(output('chmod-calculator', { mode: 'octal', octal: 644 })).rejects.toThrow();
  });

  it('preserves unrelated UTM query bytes, order, duplicates and fragments', async () => {
    const url =
      'https://example.com/p?x=a%20b&x=a+b&tilde=%7E&utm_source=old&utm_source=again#f%20g';
    expect(
      (await json('utm-link-builder', { url, source: 'A&B', medium: 'email', campaign: 'café' }))
        .url,
    ).toBe(
      'https://example.com/p?x=a%20b&x=a+b&tilde=%7E&utm_source=A%26B&utm_medium=email&utm_campaign=caf%C3%A9#f%20g',
    );
    expect(
      (
        await json('utm-link-builder', {
          url: 'https://example.com/?utm_term=old&utm_other=x',
          source: 's',
          medium: 'm',
          campaign: 'c',
        })
      ).url,
    ).toBe('https://example.com/?utm_other=x&utm_source=s&utm_medium=m&utm_campaign=c');
    for (const url of [
      'javascript:alert(1)',
      'https://user:password@example.com/',
      'https://example.com/?%zz=a',
    ])
      await expect(
        output('utm-link-builder', { url, source: 's', medium: 'm', campaign: 'c' }),
      ).rejects.toThrow();
    await expect(
      output('utm-link-builder', { source: '\ud800', medium: 'm', campaign: 'c' }),
    ).rejects.toThrow(/surrogate/);
  });

  it('serializes fixed-order CSP sources and keeps unsafe tokens out', async () => {
    expect(await output('csp-header-generator')).toBe(
      "Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'",
    );
    expect(await output('csp-header-generator', { reportOnly: true })).toMatch(
      /^Content-Security-Policy-Report-Only:/,
    );
    for (const sources of [
      "'unsafe-inline'",
      '*',
      "'none' 'self'",
      'https://example.com/path',
      "'self'; script-src *",
      "'self'\n",
    ])
      expect(() =>
        cspHeader({
          directivesJson: rows([{ directive: 'script-src', sources }]),
          reportOnly: false,
        }),
      ).toThrow();
    expect(
      cspHeader({
        directivesJson: rows([
          { directive: 'img-src', sources: "'self' data: blob: https://images.example.com" },
        ]),
        reportOnly: false,
      }),
    ).toContain('data: blob:');
    expect(() =>
      cspHeader({
        directivesJson: rows([{ directive: 'script-src', sources: 'data:' }]),
        reportOnly: false,
      }),
    ).toThrow();
  });

  it('canonicalizes language syntax and escapes HTML without inferring regions', async () => {
    const linksJson = rows([
      { language: 'en_US', url: 'https://example.com/?a=1&b=2' },
      { language: 'x-default', url: 'https://example.com/?a=1&b=2' },
    ]);
    expect(await output('hreflang-tag-generator', { linksJson })).toBe(
      '<link rel="alternate" hreflang="en-US" href="https://example.com/?a=1&amp;b=2">\n<link rel="alternate" hreflang="x-default" href="https://example.com/?a=1&amp;b=2">\n',
    );
    expect(
      hreflangTags({ linksJson: rows([{ language: 'en-ZZ', url: 'https://example.com/' }]) }),
    ).toContain('en-ZZ');
    expect(() =>
      hreflangTags({
        linksJson: rows([
          { language: 'en_US', url: 'https://example.com/a' },
          { language: 'en-US', url: 'https://example.com/b' },
        ]),
      }),
    ).toThrow(/unique/);
    expect(() =>
      hreflangTags({
        linksJson: rows([{ language: 'not_a_tag!!!', url: 'https://example.com/' }]),
      }),
    ).toThrow();
  });

  it('generates exact-path nginx blocks without interpolated directives', async () => {
    expect(
      await output('nginx-redirect-generator', {
        redirectsJson: rows([{ source: '/old', destination: '/new?a=1&b=2', status: 301 }]),
      }),
    ).toBe('location = /old { return 301 "/new?a=1&b=2"; }\n');
    expect(
      nginxRedirects({
        redirectsJson: rows([
          { source: '/old', destination: 'https://example.com/new', status: 308 },
        ]),
      }),
    ).toBe('location = /old { return 308 "https://example.com/new"; }\n');
    for (const destination of [
      '//evil.example',
      '/new;return',
      '/new#fragment',
      '/$var',
      '/%0A',
      '/%5C',
      '/a"b',
    ])
      expect(() =>
        nginxRedirects({ redirectsJson: rows([{ source: '/old', destination, status: 301 }]) }),
      ).toThrow();
    expect(() =>
      nginxRedirects({
        redirectsJson: rows([
          { source: '/%ab', destination: '/new', status: 301 },
          { source: '/%AB', destination: '/newer', status: 301 },
        ]),
      }),
    ).toThrow(/source|normalized/i);
    expect(() =>
      nginxRedirects({
        redirectsJson: rows([
          { source: '/old', destination: '/new', status: 301 },
          { source: '/old', destination: '/newer', status: 301 },
        ]),
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      nginxRedirects({
        redirectsJson: rows([{ source: '/old', destination: '/new', status: 300 }]),
      }),
    ).toThrow(/status/);
  });

  it('generates only in-gamut gradients and preserves alpha and stop order', async () => {
    expect((await json('css-gradient-generator', {})).css).toBe(
      'linear-gradient(90deg, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 1) 100%)',
    );
    expect(
      (await json('css-gradient-generator', { color1: 'rgba(255, 0, 0, 0.5)' })).css,
    ).toContain('rgba(255, 0, 0, 0.5)');
    for (const params of [
      { color1: 'url(https://example.com)' },
      { color1: 'color(display-p3 1 0 0)' },
      { stop1: 90, stop2: 10 },
      { angle: Infinity },
    ])
      await expect(output('css-gradient-generator', params)).rejects.toThrow();
  });

  it('rounds exact decimal pixel/rem arithmetic at six fractional digits', async () => {
    expect(await json('px-to-rem-converter', {})).toEqual({
      value: '1',
      approximation: false,
      unit: 'rem',
      rootPx: '16',
    });
    expect(await json('px-to-rem-converter', { value: '1', rootPx: '3' })).toEqual({
      value: '0.333333',
      approximation: true,
      unit: 'rem',
      rootPx: '3',
    });
    expect(
      (await json('px-to-rem-converter', { mode: 'rem-to-px', value: '.333333', rootPx: '3' }))
        .value,
    ).toBe('0.999999');
    expect((await json('px-to-rem-converter', { value: '0' })).value).toBe('0');
    for (const params of [{ rootPx: '0' }, { value: '1e3' }, { value: 16 }, { value: '1.0000001' }])
      await expect(output('px-to-rem-converter', params)).rejects.toThrow();
  });

  it('rejects untrusted row shapes, unknown params, malformed UTF8 and cancelled work', async () => {
    for (const groupsJson of [
      'null',
      '{}',
      '[{"userAgent":"*","rule":"Allow","path":"/","extra":1}]',
      '[{"userAgent":"*","rule":"Allow","__proto__":"/"}]',
    ])
      await expect(output('robots-txt-generator', { groupsJson })).rejects.toThrow();
    await expect(
      output('robots-txt-generator', {
        groupsJson: rows([{ userAgent: '*', rule: 'Allow', path: '/' }]),
        extra: true,
      }),
    ).rejects.toThrow(/Unknown/);
    await expect(
      output(
        'remove-duplicate-lines-online',
        {},
        new File([new Uint8Array([0xc3])], 'invalid.txt'),
      ),
    ).rejects.toThrow(/UTF-8/);
    await expect(
      output(
        'remove-duplicate-lines-online',
        {},
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.txt'),
      ),
    ).rejects.toThrow(/5 MiB/);
    expect(() => assertUnicode('\ud800')).toThrow(/surrogate/);
    expect(() => assertUnicode('👩‍💻')).not.toThrow();
    const ctx = context();
    const controller = new AbortController();
    controller.abort();
    await expect(
      output('javascript-minifier', {}, 'const a = 1', { ...ctx, signal: controller.signal }),
    ).rejects.toThrow(/Cancelled/);
  });
});
