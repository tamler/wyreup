import { afterEach, describe, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { domainAgeChecker, trustedDomainApiOrigin } from '../../src/utilities/domain-age.js';
import { domainStatusResult } from '../../src/lib/domain-registration.js';
import type { ToolRunContext } from '../../src/types.js';

const response = () => new Response(JSON.stringify(domainStatusResult('example.com', 'unsupported-tld', Temporal.Instant.from('2026-10-11T00:00:00Z'))), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const context = (signal = new AbortController().signal): ToolRunContext => ({ signal, onProgress: vi.fn(), executionId: 'domain-test', cache: new Map(), proOrigin: 'http://127.0.0.1:1888', apiKey: 'private-canary-never-sent' });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('trusted all-surface registration client', () => {
  it('sends only a canonical domain to the trusted API with no credentials or registry egress', async () => {
    const fetcher = vi.fn(() => Promise.resolve(response())); vi.stubGlobal('fetch', fetcher);
    const output = await domainAgeChecker.run([], { domain: ' EXAMPLE.COM. ' }, context());
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe('http://127.0.0.1:1888/api/domain-age');
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', body: '{"domain":"example.com"}', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.stringify(options)).not.toContain('private-canary');
    expect(Array.isArray(output) && output[0]!.type).toBe('application/json');
  });

  it('rejects invalid origins and invalid domains before fetching', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const proOrigin of ['http://remote.example', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?x=1', 'ftp://example.com'])
      expect(() => trustedDomainApiOrigin({ proOrigin })).toThrow();
    expect(trustedDomainApiOrigin({})).toBe('https://wyreup.com');
    expect(trustedDomainApiOrigin({ proOrigin: 'http://[::1]:1888' })).toBe('http://[::1]:1888');
    await expect(domainAgeChecker.run([], { domain: 'https://example.com' }, context())).rejects.toThrow();
    await expect(domainAgeChecker.run([], { domain: 'example.com', endpoint: 'https://elsewhere.example' }, context())).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects mismatched or oversized responses without exposing provider content', async () => {
    for (const body of ['{"domain":"private.example","status":"ok"}', 'x'.repeat(16385)]) {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/json' } }))));
      await expect(domainAgeChecker.run([], { domain: 'example.com' }, context())).rejects.toThrow('Domain lookup failed');
    }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('PRIVATE UPSTREAM BODY', { status: 500, headers: { 'Content-Type': 'text/html' } }))));
    await expect(domainAgeChecker.run([], { domain: 'example.com' }, context())).rejects.toThrow('Domain lookup failed');
  });

  it('settles at its deadline even when a transport ignores abort, and rejects late results', async () => {
    vi.useFakeTimers();
    const started = Date.now();
    let finish!: (value: Response) => void;
    let invoked!: (signal: AbortSignal) => void;
    const invocation = new Promise<AbortSignal>(resolve => { invoked = resolve; });
    const fetcher = vi.fn((_url: unknown, options: RequestInit) => new Promise<Response>(resolve => {
      finish = resolve;
      if (!options.signal) throw new Error('Missing owned transport signal.');
      invoked(options.signal);
    }));
    vi.stubGlobal('fetch', fetcher);
    let state = 'pending';
    const ctx = context();
    const operation = domainAgeChecker.run([], { domain: 'example.com' }, ctx).then(() => { state = 'fulfilled'; }, () => { state = 'rejected'; });
    try {
      const signal = await invocation;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
      expect(Date.now()).toBe(started);
      await vi.advanceTimersByTimeAsync(10000);
      expect(signal.aborted).toBe(true);
      expect(state).toBe('rejected');
    } finally { finish(response()); await operation; }
    expect(ctx.onProgress).not.toHaveBeenCalledWith({ stage: 'done', percent: 100 });
  });
});
