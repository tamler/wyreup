import { afterEach, expect, it, vi } from 'vitest';
import { onRequest } from './domain-age';
import type { PagesFunctionContext } from '../_lib/types';
import type * as Admission from '../_lib/public-rate-limit';

vi.mock('../_lib/public-rate-limit', async importOriginal => ({
  ...await importOriginal<typeof Admission>(),
  acquireDomainIsolateSlot: () => () => {},
  reserveDomainLookup: () => Promise.resolve({ release: () => Promise.resolve() }),
}));
afterEach(() => vi.unstubAllGlobals());

it.each([429, 503])('retains explicit provider status without exposing provider body for HTTP %s', async status => {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(input => Promise.resolve((input instanceof Request ? input.url : input.toString()).includes('data.iana.org')
    ? new Response(JSON.stringify({ services: [[['com'], ['https://rdap.registry.net/']]] }),
      { headers: { 'Content-Type': 'application/json' } })
    : new Response('private-provider-body', { status, headers: { 'Retry-After': '12' } }))));
  const pending: Promise<unknown>[] = [];
  const ctx = {
    request: new Request('https://wyreup.com/api/domain-age', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
      body: '{"domain":"example.com"}' }),
    env: { DB: {}, SESSION_SECRET: 'synthetic-provider-status-test' },
    waitUntil: (promise: Promise<unknown>) => { pending.push(promise); },
  } as unknown as PagesFunctionContext;
  const response = await onRequest(ctx);
  expect(response.status).toBe(200);
  expect(response.headers.get('Retry-After')).toBe(status === 429 ? '12' : null);
  const body = await response.json() as Record<string, unknown>;
  expect(body).toMatchObject({ status: status === 429 ? 'rate-limited' : 'provider-error', ageDays: null, calendarAge: null });
  expect(JSON.stringify(body)).not.toContain('private-provider-body');
  await Promise.all(pending);
});
