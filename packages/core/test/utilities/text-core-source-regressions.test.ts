import { describe, expect, it } from 'vitest';
import type { ToolRunContext } from '../../src/types.js';
import { calculateAspectRatio } from '../../src/utilities/aspect-ratio.js';
import { beautifyCode, type BeautifierLanguage } from '../../src/utilities/code-beautifier.js';
import {
  bulkMetaDescriptions,
  cspHeader,
  cssGradient,
  nginxRedirects,
} from '../../src/utilities/text-developer.js';
import type { UtilityParams } from '../../src/utilities/common.js';

const context = (signal = new AbortController().signal): ToolRunContext => ({
  signal,
  executionId: 'independent-text-core-regressions',
  cache: new Map(),
  onProgress() {},
});
const redirects = (source: string) => ({
  redirectsJson: JSON.stringify([{ source, destination: '/new?a=1&b=2', status: 301 }]),
});
const csp = (sources: string) => ({
  directivesJson: JSON.stringify([{ directive: 'script-src', sources }]),
  reportOnly: false,
});
const gradient = (color1: string) => ({
  color1,
  color2: '#000000',
  angle: 90,
  stop1: 0,
  stop2: 100,
});

describe('independent normalized-source nginx regressions', () => {
  it.each(['/%7E', '/%2f', '/%AB', '/a//b', '/a/./b', '/a/../b'])(
    'rejects ambiguous raw request source %s',
    (source) => {
      expect(() => nginxRedirects(redirects(source))).toThrow(/source|path|normal|percent/i);
    },
  );
  it('retains ordinary segment dots and the exact quoted redirect artifact', () => {
    expect(nginxRedirects(redirects('/.well-known'))).toBe(
      'location = /.well-known { return 301 "/new?a=1&b=2"; }\n',
    );
    expect(nginxRedirects(redirects('/old'))).toBe(
      'location = /old { return 301 "/new?a=1&b=2"; }\n',
    );
  });
});

describe('independent raw-origin CSP regressions', () => {
  it.each([
    'https://example.com?',
    'https://example.com#',
    'https://example.com\\',
    'https://example.com/.',
    'https://example.com/%2e',
    'https://a_b.example',
    'https://[::1]',
  ])('rejects unsupported origin syntax %s', (sources) => {
    expect(() => cspHeader(csp(sources))).toThrow(/origin|CSP|host|source|HTTPS/i);
  });
  it('serializes IDN and uppercase origin hosts as supported ASCII source tokens', () => {
    expect(cspHeader(csp('HTTPS://BÜCHER.example:443/'))).toBe(
      'Content-Security-Policy: script-src https://xn--bcher-kva.example',
    );
    expect(cspHeader(csp('https://EXAMPLE.com:443/'))).toBe(
      'Content-Security-Policy: script-src https://example.com',
    );
  });
});

describe('independent gradient roundoff regressions', () => {
  it.each(['lab(100% 0 0)', 'hsl(0 0% 100%)'])(
    'retains mathematically neutral white from %s',
    async (color1) => {
      expect(await cssGradient(gradient(color1))).toEqual({
        css: 'linear-gradient(90deg, rgba(255, 255, 255, 1) 0%, rgba(0, 0, 0, 1) 100%)',
      });
    },
  );
  it.each(['color(display-p3 1 0 0)', 'color(srgb 1.00001 0 0)'])(
    'rejects actual out-of-gamut %s',
    async (color1) => {
      await expect(cssGradient(gradient(color1))).rejects.toThrow(/gamut|finite|alpha/i);
    },
  );
  it.each([
    [
      'rgba(255, 0, 0, 1.00000001)',
      'linear-gradient(90deg, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 0, 1) 100%)',
    ],
    [
      'rgba(255, 0, 0, -0.00000001)',
      'linear-gradient(90deg, rgba(255, 0, 0, 0) 0%, rgba(0, 0, 0, 1) 100%)',
    ],
  ])('retains CSS parsed-alpha semantics for %s', async (color1, expected) => {
    expect(await cssGradient(gradient(color1))).toEqual({ css: expected });
  });
});

describe('independent bulk-description expansion and cancellation bounds', () => {
  const bulkWithContext: (text: string, params: UtilityParams, ctx?: ToolRunContext) => string =
    bulkMetaDescriptions;
  const params = (template: string) => ({ delimiter: 'comma', template, maxGraphemes: 8 });
  // Whitespace contracts after expansion keep the old segmentation path small;
  // budgets still count the full expanded source, not the normalized preview.
  const title = `${' '.repeat(499)}x${' '.repeat(500)}`;

  it('rejects a 1.5 MB expanded description from a small title and template', () => {
    expect(new TextEncoder().encode(title).length).toBe(1000);
    const template = '{title}'.repeat(1500);
    expect(new TextEncoder().encode(template).length).toBe(10500);
    expect(() => bulkMetaDescriptions(`title,topic,url\n${title},,/one`, params(template))).toThrow(
      /1\s*MiB|expanded.*(?:budget|limit|exceed)/i,
    );
  });
  it('rejects aggregate expansion above 20 MiB while every row remains below 1 MiB', () => {
    const input = `title,topic,url\n${Array.from({ length: 21 }, (_, index) => `${title},,/row-${index + 1}`).join('\n')}`;
    expect(new TextEncoder().encode(input).length).toBeLessThan(22000);
    expect(() => bulkMetaDescriptions(input, params('{title}'.repeat(1000)))).toThrow(
      /20\s*MiB|aggregate.*(?:budget|limit|exceed)/i,
    );
  });
  it('honors an already-aborted helper context before parsing invalid input', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      bulkWithContext('invalid-header\nvalue', params('{title}'), context(controller.signal)),
    ).toThrow(/cancel|abort/i);
  });
  it('preserves the exact emoji and word-boundary descriptions', () => {
    expect(
      bulkMetaDescriptions('title,topic,url\n👩‍💻abc,,/emoji', {
        ...params('{title}'),
        maxGraphemes: 2,
      }),
    ).toBe('url,title,description,graphemeCount,truncated,error\n/emoji,👩‍💻abc,👩‍💻a,2,true,');
    expect(
      bulkMetaDescriptions('title,topic,url\nHello long world,,/words', params('{title}')),
    ).toBe(
      'url,title,description,graphemeCount,truncated,error\n/words,Hello long world,Hello,5,true,',
    );
  });
});

const beautifierOracles: ReadonlyArray<readonly [BeautifierLanguage, string, string]> = [
  ['javascript', 'const x={a:1}', 'const x = { a: 1 };\n'],
  ['json', '{"b":1,"a":2}', '{\n  "b": 1,\n  "a": 2\n}'],
  ['css', 'a{color:red}', 'a {\n  color: red;\n}\n'],
  ['html', '<div><span>Hello</span></div>', '<div><span>Hello</span></div>\n'],
  ['xml', '<root><item>1</item></root>', '<root>\n  <item>1</item>\n</root>\n'],
  ['sql', 'select a from users where x=1', 'SELECT\n  a\nFROM\n  users\nWHERE\n  x = 1'],
];
describe('independent exported beautifier regressions', () => {
  it.each(beautifierOracles)('keeps the literal %s golden', async (language, input, expected) => {
    expect(await beautifyCode(input, language, context())).toBe(expected);
  });
  it.each([
    ['json', '{"a":'],
    ['css', 'a { color: red;'],
  ] as const)('returns the real %s parser rejection', async (language, input) => {
    await expect(beautifyCode(input, language, context())).rejects.toThrow();
  });
  it.each([
    ['javascript', 'const x="\ud800"'],
    ['json', '{"x":"\ud800"}'],
    ['css', 'a{content:"\ud800"}'],
    ['html', '<div>\ud800</div>'],
    ['xml', '<root>\ud800</root>'],
    ['sql', "select '\ud800'"],
  ] as const)('rejects raw lone surrogates before encoding %s', async (language, input) => {
    await expect(beautifyCode(input, language, context())).rejects.toThrow(/surrogate|Unicode/i);
  });
});

it('reduces 0.125:0.05 to the independently known exact 5:2 ratio', () => {
  expect(calculateAspectRatio({ width: '0.125', height: '0.05' })).toMatchObject({
    width: '0.125',
    height: '0.05',
    ratio: '5:2',
    approximate: false,
  });
});
