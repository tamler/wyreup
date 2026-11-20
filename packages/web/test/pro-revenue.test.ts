import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseProductionRedirects, redirectLocation } from '../scripts/production-headers.mjs';

describe('legacy commercial routes', () => {
  const redirects = parseProductionRedirects(
    readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8'),
  );

  it.each(['/pro', '/account', '/admin', '/pricing', '/legal/pricing', '/legal/refund'])(
    'redirects %s with and without a trailing slash',
    (path) => {
      for (const from of [path, `${path}/`]) {
        expect(redirects.find((rule) => rule.from === from)).toEqual({
          from,
          to: path === '/legal/refund' ? '/legal/terms' : '/tools',
          status: 301,
        });
      }
    },
  );

  it('keeps a request query ahead of the destination fragment', () => {
    expect(redirectLocation('/page/#details', '?utm=1')).toBe('/page/?utm=1#details');
    expect(redirectLocation('/page/', '?utm=1')).toBe('/page/?utm=1');
    expect(redirectLocation('/page/#details', '')).toBe('/page/#details');
  });

  it('accepts a fragment only in the destination', () => {
    expect(parseProductionRedirects('/a /b/#c-1 301')).toEqual([
      { from: '/a', to: '/b/#c-1', status: 301 },
    ]);
    expect(() => parseProductionRedirects('/a#x /b/ 301')).toThrow();
    expect(() => parseProductionRedirects('/a /b/#c d 301')).toThrow();
    expect(() => parseProductionRedirects('/a /b/#<x> 301')).toThrow();
  });

});
