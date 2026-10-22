import { afterEach, describe, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { domainAgeChecker } from '../../src/utilities/domain-age.js';
import { domainStatusResult } from '../../src/lib/domain-registration.js';
import type { ToolRunContext } from '../../src/types.js';

const response = () =>
  new Response(
    JSON.stringify(
      domainStatusResult(
        'example.com',
        'unsupported-tld',
        Temporal.Instant.from('2026-10-11T00:00:00Z'),
      ),
    ),
    { headers: { 'Content-Type': 'application/json' } },
  );
const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  onProgress: vi.fn(),
  executionId: 'offline-client-test',
  cache: new Map(),
  proOrigin: 'http://127.0.0.1:1888',
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('known offline registration admission before public network work', () => {
  it('refuses a browser-reported offline lookup before any progress or fetch', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetcher = vi.fn(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetcher);
    const ctx = context();
    await expect(domainAgeChecker.run([], { domain: 'example.com' }, ctx)).rejects.toThrow(
      'Domain registration lookup requires a network connection.',
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(ctx.onProgress).not.toHaveBeenCalled();
  });
  it('retains domain validation before the offline refusal', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetcher = vi.fn(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetcher);
    const ctx = context();
    await expect(domainAgeChecker.run([], { domain: 'https://example.com' }, ctx)).rejects.toThrow(
      'Enter one valid public domain name, without a URL, port or credentials.',
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(ctx.onProgress).not.toHaveBeenCalled();
  });
  it.each([undefined, {}, { onLine: true }])(
    'retains ordinary transport when offline is not explicitly false: %j',
    async (navigator) => {
      vi.stubGlobal('navigator', navigator);
      const fetcher = vi.fn(() => Promise.resolve(response()));
      vi.stubGlobal('fetch', fetcher);
      const ctx = context();
      const output = await domainAgeChecker.run([], { domain: 'example.com' }, ctx);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(Array.isArray(output)).toBe(true);
      if (!Array.isArray(output)) throw new Error('Expected the actual domain result array.');
      const value: unknown = JSON.parse(await output[0]!.text());
      expect(value).toMatchObject({ status: 'unsupported-tld' });
      expect(ctx.onProgress).toHaveBeenLastCalledWith({ stage: 'done', percent: 100 });
    },
  );
});
