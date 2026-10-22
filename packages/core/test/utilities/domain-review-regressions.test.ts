import { afterEach, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { domainAgeChecker } from '../../src/utilities/domain-age.js';
import { extractRegistrationAge } from '../../src/lib/domain-registration.js';
import { domainStatusResult } from '../../src/lib/domain-registration.js';
import type { ToolRunContext } from '../../src/types.js';

const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  onProgress: vi.fn(),
  executionId: 'domain-review',
  cache: new Map(),
});
afterEach(() => vi.unstubAllGlobals());

it('preserves safe capacity and unavailable messages without upstream details', async () => {
  for (const [status, expected] of [
    [429, 'Try again in 12 seconds.'],
    [503, 'temporarily unavailable'],
  ] as const) {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          Promise.resolve(new Response('private-provider-body', {
            status,
            headers: { 'Retry-After': '12' },
          })),
      ),
    );
    await expect(domainAgeChecker.run([], { domain: 'example.com' }, context())).rejects.toThrow(
      expected,
    );
  }
});

it('gives a safe local validation message before transport', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(
    domainAgeChecker.run([], { domain: 'https://private.example' }, context()),
  ).rejects.toThrow('Enter one valid public domain name');
  expect(fetcher).not.toHaveBeenCalled();
});

it('reports provider throttle and failure as explicit safe tool errors', async () => {
  for (const [status, expected] of [['rate-limited', 'Try again in 12 seconds.'],
    ['provider-error', 'temporarily unavailable']] as const) {
    const result = domainStatusResult('example.com', status, Temporal.Instant.from('2026-10-11T00:00:00Z'),
      'rdap.registry.net', 'https://rdap.registry.net/domain/example.com');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Retry-After': '12' },
    }))));
    await expect(domainAgeChecker.run([], { domain: 'example.com' }, context())).rejects.toThrow(expected);
  }
});

it('checks optional RDAP unicodeName against the expected canonical domain', () => {
  const domain = 'xn--bcher-kva.example';
  const now = Temporal.Instant.from('2026-10-11T00:00:00Z');
  const base = {
    objectClassName: 'domain',
    ldhName: domain,
    events: [{ eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' }],
  };
  const read = (response: unknown) =>
    extractRegistrationAge(
      response,
      domain,
      now,
      'rdap.example',
      'https://rdap.example/domain/' + domain,
    );
  expect(read(base).status).toBe('ok');
  expect(read({ ...base, unicodeName: 'bücher.example' }).status).toBe('ok');
  for (const unicodeName of ['different.example', null, 12, 'https://private.example'])
    expect(read({ ...base, unicodeName }).status).toBe('malformed');
});
