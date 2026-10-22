import { describe, expect, it } from 'vitest';
import {
  cspHeader,
  hreflangTags,
  nginxRedirects,
  robotsText,
} from '../../core/src/utilities/text-developer.js';
import {
  decodeGeneratorRows,
  encodeGeneratorRows,
  exportGeneratorRows,
  generatorRowContracts,
  importGeneratorRows,
  validateGeneratorRows,
} from '../src/components/runners/generatorRows';

const robots = generatorRowContracts('robots-txt-generator');
const csp = generatorRowContracts('csp-header-generator')[0];
const hreflang = generatorRowContracts('hreflang-tag-generator')[0];
const nginx = generatorRowContracts('nginx-redirect-generator')[0];

describe('generator input projection and actual core semantics', () => {
  it('imports exact named robots headers and preserves empty Disallow', () => {
    const groupsJson = JSON.stringify(
      importGeneratorRows(
        'userAgent,rule,path\n*,Disallow,/private/\n*,Allow,/private/public/\nExampleBot,Disallow,\n',
        'comma',
        robots[0],
      ),
    );
    const sitemapsJson = JSON.stringify(
      importGeneratorRows('url\nhttps://example.com/sitemap.xml\n', 'comma', robots[1]),
    );
    expect(robotsText({ groupsJson, sitemapsJson })).toBe(
      'User-agent: *\nDisallow: /private/\nAllow: /private/public/\n\nUser-agent: ExampleBot\nDisallow:\n\nSitemap: https://example.com/sitemap.xml\n',
    );
  });
  it('projects only the nginx status to a numeric JSON field', () => {
    const rows = importGeneratorRows(
      'status\tdestination\tsource\n301\t/new?a=1&b=2\t/old\n',
      'tab',
      nginx,
    );
    expect(rows).toEqual([{ source: '/old', destination: '/new?a=1&b=2', status: 301 }]);
    expect(nginxRedirects({ redirectsJson: encodeGeneratorRows(rows, nginx) })).toBe(
      'location = /old { return 301 "/new?a=1&b=2"; }\n',
    );
  });
  it.each(['3e2', '0301', '301.0', ' 301', '200', ''])(
    'rejects ambiguous or unsupported status %j',
    (status) => {
      expect(() =>
        importGeneratorRows(`source,destination,status\n/old,/new,${status}\n`, 'comma', nginx),
      ).toThrow('HTTP status');
    },
  );
  it('checks CSP against actual canonical order and report-only behavior', () => {
    const rows = importGeneratorRows(
      "directive,sources\nobject-src,'none'\nbase-uri,'self'\ndefault-src,'self'\n",
      'comma',
      csp,
    );
    const directivesJson = encodeGeneratorRows(rows, csp);
    expect(cspHeader({ directivesJson, reportOnly: false })).toBe(
      "Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'",
    );
    expect(cspHeader({ directivesJson, reportOnly: true })).toBe(
      "Content-Security-Policy-Report-Only: default-src 'self'; base-uri 'self'; object-src 'none'",
    );
    expect(() =>
      encodeGeneratorRows([{ directive: 'script-src', sources: "'unsafe-inline'" }], csp),
    ).toThrow();
  });
  it('retains malicious-looking URL bytes as escaped literal hreflang code', () => {
    const rows = [
      { language: 'en_US', url: 'https://example.com/?q=<script>"&x=1' },
      { language: 'x-default', url: 'https://example.com/?q=<script>"&x=1' },
    ];
    expect(hreflangTags({ linksJson: encodeGeneratorRows(rows, hreflang) })).toBe(
      '<link rel="alternate" hreflang="en-US" href="https://example.com/?q=&lt;script&gt;&quot;&amp;x=1">\n<link rel="alternate" hreflang="x-default" href="https://example.com/?q=&lt;script&gt;&quot;&amp;x=1">\n',
    );
  });
  it('rejects canonical language duplicates through core', () => {
    expect(() =>
      encodeGeneratorRows(
        [
          { language: 'en_US', url: 'https://example.com/' },
          { language: 'en-US', url: 'https://example.org/' },
        ],
        hreflang,
      ),
    ).toThrow('unique canonical');
  });
  it.each([
    'source,destination,status,status\n/old,/new,301,301',
    'source,destination,__proto__\n/old,/new,301',
    'source,destination\n/old,/new',
    'Source,destination,status\n/old,/new,301',
  ])('rejects nonexact named headers', (source) => {
    expect(() => importGeneratorRows(source, 'comma', nginx)).toThrow();
  });
  it('rejects extra row cells and malformed quotes', () => {
    expect(() =>
      importGeneratorRows('language,url\nen,https://example.com/,extra', 'comma', hreflang),
    ).toThrow();
    expect(() =>
      importGeneratorRows('language,url\nen,"https://example.com/', 'comma', hreflang),
    ).toThrow('CSV parse');
  });
  it('never evaluates getters and rejects unknown/prototype data', () => {
    let called = false;
    const row = {
      language: 'en',
      get url() {
        called = true;
        return 'https://example.com/';
      },
    };
    expect(() => validateGeneratorRows([row], hreflang)).toThrow();
    expect(called).toBe(false);
    expect(() =>
      decodeGeneratorRows(
        '[{"language":"en","url":"https://example.com/","__proto__":{}}]',
        hreflang,
      ),
    ).toThrow();
    expect(() =>
      validateGeneratorRows(
        [Object.create({ language: 'en', url: 'https://example.com/' })],
        hreflang,
      ),
    ).toThrow();
  });
  it('locks row count and UTF8 byte budgets before parsing', () => {
    expect(() =>
      importGeneratorRows(
        'language,url\n' + 'en,https://example.com/\n'.repeat(1001),
        'comma',
        hreflang,
      ),
    ).toThrow('row');
    expect(() => importGeneratorRows('é'.repeat(50001), 'comma', hreflang)).toThrow('100,000');
    expect(() => importGeneratorRows('\uD800', 'comma', hreflang)).toThrow();
  });
  it('uses real core validation for paths, grouping and injection', () => {
    expect(() =>
      encodeGeneratorRows([{ source: '/old', destination: '/new%0Areturn', status: 301 }], nginx),
    ).toThrow('Encoded');
    expect(() =>
      encodeGeneratorRows([{ userAgent: '*', rule: 'Allow', path: '' }], robots[0]),
    ).toThrow('slash-leading');
    expect(() =>
      encodeGeneratorRows([{ url: 'https://example.com/#fragment' }], robots[1]),
    ).toThrow('fragment');
  });
  it('roundtrips complete CSV/TSV rows including quoted commas and reorders headers by name', () => {
    const rows = Array.from({ length: 53 }, (_, i) => ({
      source: `/old${i}`,
      destination: `/new?q=a,b&row=${i}`,
      status: 308,
    }));
    for (const mode of ['comma', 'tab'] as const)
      expect(importGeneratorRows(exportGeneratorRows(rows, mode, nginx), mode, nginx)).toEqual(
        rows,
      );
    expect(decodeGeneratorRows(encodeGeneratorRows(rows, nginx), nginx)).toEqual(rows);
  });
});
