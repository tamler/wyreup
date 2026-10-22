import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupDomainRegistration, parseBootstrap, selectRdapSource } from './rdap';
import {
  registrationInstant,
  validateDomainRegistration,
} from '../../packages/core/src/lib/domain-registration';

const IANA = 'https://data.iana.org/rdap/dns.json';
const SOURCE = 'https://rdap.registry.net/v1/domain/example.com';
const bootstrap = {
  services: [[['com'], ['https://rdap.registry.net/v1/', 'https://other.registry.net/']]],
};
const record = {
  objectClassName: 'domain',
  ldhName: 'EXAMPLE.COM',
  events: [{ eventAction: 'registration', eventDate: '2024-01-01T12:00:00Z' }],
};
const now = () => registrationInstant('2025-01-01T11:00:00Z');
const json = (value: unknown, media = 'application/rdap+json') =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': media } });
const signal = () => new AbortController().signal;
const href = (input: RequestInfo | URL) =>
  input instanceof Request ? input.url : input.toString();
function headersList(init: HeadersInit | undefined) {
  const entries: [string, string][] = [];
  new Headers(init).forEach((value, key) => entries.push([key, value]));
  return entries;
}
function scripted(responses: Response[]) {
  return vi.fn<typeof fetch>(() => {
    const response = responses.shift();
    return response
      ? Promise.resolve(response)
      : Promise.reject(new Error('Unexpected provider request.'));
  });
}
function lookup(value: unknown) {
  const fetcher = scripted([json(bootstrap, 'application/json'), json(value)]);
  return lookupDomainRegistration('example.com', signal(), fetcher, now);
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('independent RDAP bootstrap and selection contract', () => {
  it('normalizes mixed-case duplicates and selects the longest complete label suffix', () => {
    const services = parseBootstrap({
      services: [
        [['UK'], ['https://uk.registry.net/']],
        [['co.UK'], ['https://specific.registry.net/']],
        [['CO.uk'], ['https://specific.registry.net/']],
        [['example.com'], ['https://nested.registry.net/']],
      ],
    });
    expect(services).toHaveLength(3);
    expect(selectRdapSource(services, 'example.co.uk')?.href).toBe(
      'https://specific.registry.net/domain/example.co.uk',
    );
    expect(selectRdapSource(services, 'co.uk')?.href).toBe(
      'https://specific.registry.net/domain/co.uk',
    );
    expect(selectRdapSource(services, 'goodexample.com')).toBeNull();
    expect(selectRdapSource(services, 'sub.example.com')?.hostname).toBe('nested.registry.net');
  });
  it('rejects conflicting duplicate ordered bases, including normalized mixed case', () => {
    expect(() =>
      parseBootstrap({
        services: [
          [['COM'], ['https://a.registry.net/', 'https://b.registry.net/']],
          [['com'], ['https://b.registry.net/', 'https://a.registry.net/']],
        ],
      }),
    ).toThrow();
  });
  it.each([
    null,
    {},
    { services: {} },
    { services: [[[], ['https://rdap.registry.net/']]] },
    { services: [[['com'], []]] },
    { services: [[['com.'], ['https://rdap.registry.net/']]] },
    { services: [[['com'], [12]]] },
  ])('rejects malformed bootstrap structure %#', (value) => {
    expect(() => parseBootstrap(value)).toThrow();
  });
  it.each([
    'http://rdap.registry.net/',
    'https://user:secret@rdap.registry.net/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://localhost/',
    'https://rdap.local/',
    'https://rdap.registry.net:444/',
    'https://rdap.registry.net/path',
    'https://rdap.registry.net/?q=x',
    'https://rdap.registry.net/#x',
  ])('skips unacceptable base %s without requesting it', (invalid) => {
    const services = parseBootstrap({
      services: [[['com'], [invalid, 'https://rdap.registry.net:443/v1/']]],
    });
    expect(selectRdapSource(services, 'example.com')?.href).toBe(SOURCE);
  });
  it('returns no source when the selected longest service has no acceptable base', () => {
    const services = parseBootstrap({
      services: [
        [['uk'], ['https://uk.registry.net/']],
        [['co.uk'], ['http://bad.registry.net/']],
      ],
    });
    expect(selectRdapSource(services, 'example.co.uk')).toBeNull();
  });
});

describe('independent bounded RDAP transport and minimized results', () => {
  it('uses only fixed bootstrap and selected source with fresh credential-free requests', async () => {
    const privateRecord = {
      ...record,
      entities: [{ vcardArray: ['vcard', [['email', {}, 'text', 'PERSONAL_CANARY']]] }],
      notices: [{ links: [{ href: 'https://evil.registry.net/' }] }],
      eventActor: 'ACTOR_CANARY',
    };
    const fetcher = scripted([
      json(bootstrap, 'APPLICATION/JSON; Charset="UTF-8"'),
      json(privateRecord, 'Application/Rdap+Json; charset=utf-8'),
    ]);
    const result = await lookupDomainRegistration('example.com', signal(), fetcher, now);
    expect(result).toMatchObject({
      domain: 'example.com',
      status: 'ok',
      ageDays: 365,
      calendarAge: { years: 1, months: 0, days: 0 },
      provider: 'rdap.registry.net',
      sourceURL: SOURCE,
    });
    expect(validateDomainRegistration(result, 'example.com')).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(
      /PERSONAL_CANARY|ACTOR_CANARY|entities|notices|evil/,
    );
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(16384);
    expect(fetcher.mock.calls.map((call) => href(call[0]))).toEqual([IANA, SOURCE]);
    for (const [url, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(headersList(init?.headers)).toEqual([
        ['accept', href(url) === IANA ? 'application/json' : 'application/rdap+json'],
      ]);
    }
  });
  it('caches only bootstrap, refreshes at 24 hours, and never caches queried records', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetcher = scripted([
      json(bootstrap, 'application/json'),
      json(record),
      json(record),
      json(bootstrap, 'application/json'),
      json(record),
    ]);
    await lookupDomainRegistration('example.com', signal(), fetcher, now);
    vi.setSystemTime(86400000 - 1);
    await lookupDomainRegistration('example.com', signal(), fetcher, now);
    vi.setSystemTime(86400000);
    await lookupDomainRegistration('example.com', signal(), fetcher, now);
    expect(fetcher.mock.calls.map((call) => href(call[0]))).toEqual([
      IANA,
      SOURCE,
      SOURCE,
      IANA,
      SOURCE,
    ]);
  });
  it('never reuses expired bootstrap after a refresh failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const fetcher = scripted([
      json(bootstrap, 'application/json'),
      json(record),
      new Response('PRIVATE_PROVIDER_FAILURE', { status: 500 }),
    ]);
    await lookupDomainRegistration('example.com', signal(), fetcher, now);
    vi.setSystemTime(86400000);
    const result = await lookupDomainRegistration('example.com', signal(), fetcher, now);
    expect(result.status).toBe('provider-error');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_FAILURE');
  });
  it('does not follow a bootstrap redirect or fail over after the selected provider fails', async () => {
    const redirected = scripted([
      new Response(null, { status: 302, headers: { Location: 'https://evil.registry.net/' } }),
    ]);
    expect((await lookupDomainRegistration('example.com', signal(), redirected, now)).status).toBe(
      'provider-error',
    );
    expect(redirected).toHaveBeenCalledTimes(1);
    const failed = scripted([
      json(bootstrap, 'application/json'),
      new Response('canary', { status: 503 }),
    ]);
    expect((await lookupDomainRegistration('example.com', signal(), failed, now)).status).toBe(
      'provider-error',
    );
    expect(failed.mock.calls.map((call) => href(call[0]))).toEqual([IANA, SOURCE]);
  });
  it.each([
    'https://other.registry.net/v1/domain/example.com',
    '/other/domain/example.com',
    '//evil.registry.net/v1/domain/example.com',
    '/v1/domain/%65xample.com',
    '/v1/domain/example.com?q=x',
    '/v1/domain/example.com#x',
    'https://user:secret@rdap.registry.net/v1/domain/example.com',
    'http://rdap.registry.net/v1/domain/example.com',
  ])('rejects unpinned redirect %s', (location) => {
    const fetcher = scripted([
      json(bootstrap, 'application/json'),
      new Response(null, { status: 302, headers: { Location: location } }),
    ]);
    return lookupDomainRegistration('example.com', signal(), fetcher, now).then((result) => {
      expect(result.status).toBe('unsupported-redirect');
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });
  it('permits two same-path redirects and rejects a third without making a fourth registry request', async () => {
    const redirect = () =>
      new Response(null, { status: 307, headers: { Location: '/v1/domain/example.com' } });
    const success = scripted([
      json(bootstrap, 'application/json'),
      redirect(),
      redirect(),
      json(record),
    ]);
    expect((await lookupDomainRegistration('example.com', signal(), success, now)).status).toBe(
      'ok',
    );
    expect(success).toHaveBeenCalledTimes(4);
    const loop = scripted([
      json(bootstrap, 'application/json'),
      redirect(),
      redirect(),
      redirect(),
    ]);
    expect((await lookupDomainRegistration('example.com', signal(), loop, now)).status).toBe(
      'unsupported-redirect',
    );
    expect(loop).toHaveBeenCalledTimes(4);
  });
  it.each([
    [404, 'not-found'],
    [429, 'rate-limited'],
    [500, 'provider-error'],
  ] as const)('minimizes upstream HTTP %i', async (status, expected) => {
    const fetcher = scripted([
      json(bootstrap, 'application/json'),
      new Response('SECRET_REGISTRANT_CANARY', { status }),
    ]);
    const result = await lookupDomainRegistration('example.com', signal(), fetcher, now);
    expect(result.status).toBe(expected);
    expect(result.registrationAt).toBeNull();
    expect(JSON.stringify(result)).not.toContain('SECRET_REGISTRANT_CANARY');
  });
  it.each([
    'application/json',
    'text/html',
    'application/rdap+json; charset=latin1',
    'application/rdap+json; charset=utf-8; boundary=x',
    'application/rdap+json; x=y',
  ])('rejects registry media %s', async (media) => {
    const fetcher = scripted([json(bootstrap, 'application/json'), json(record, media)]);
    expect((await lookupDomainRegistration('example.com', signal(), fetcher, now)).status).toBe(
      'malformed',
    );
  });
  it('rejects wrong bootstrap media before requesting any registry', async () => {
    const fetcher = scripted([json(bootstrap, 'application/rdap+json')]);
    expect((await lookupDomainRegistration('example.com', signal(), fetcher, now)).status).toBe(
      'provider-error',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...record, ldhName: 'other.com' },
    { ...record, objectClassName: 'entity' },
    {
      ...record,
      events: [
        ...record.events,
        { eventAction: 'registration', eventDate: '2025-01-01T11:00:00.000000001Z' },
      ],
    },
    { ...record, events: Array.from({ length: 33 }, () => record.events[0]) },
  ])('rejects contradictory registration data %#', async (value) => {
    expect((await lookup(value)).status).toBe('malformed');
  });
  it('uses earliest valid registration and counts invalid dates without borrowing unrelated events', async () => {
    const result = await lookup({
      ...record,
      events: [
        { eventAction: 'registration', eventDate: '2024-02-29T00:00:00+00:00' },
        { eventAction: 'registration', eventDate: '2024-01-01T12:00:00Z' },
        { eventAction: 'registration', eventDate: '2024-02-30T00:00:00Z' },
        { eventAction: 'last changed', eventDate: '2000-01-01T00:00:00Z' },
      ],
    });
    expect(result).toMatchObject({
      status: 'ok',
      registrationAt: '2024-01-01T12:00:00Z',
      ignoredInvalidRegistrationCount: 1,
      otherRegistrationInstants: ['2024-02-29T00:00:00Z'],
    });
    expect(
      (
        await lookup({
          ...record,
          events: [{ eventAction: 'last changed', eventDate: '2000-01-01T00:00:00Z' }],
        })
      ).status,
    ).toBe('unknown');
  });
  it('rejects invalid UTF-8 and actual decompressed stream bytes over one MiB', async () => {
    const invalid = scripted([
      json(bootstrap, 'application/json'),
      new Response(new Uint8Array([0xff]), {
        headers: { 'Content-Type': 'application/rdap+json' },
      }),
    ]);
    expect((await lookupDomainRegistration('example.com', signal(), invalid, now)).status).toBe(
      'malformed',
    );
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel,
    });
    const fetcher = scripted([
      json(bootstrap, 'application/json'),
      new Response(body, {
        headers: { 'Content-Type': 'application/rdap+json', 'Content-Length': '1' },
      }),
    ]);
    expect((await lookupDomainRegistration('example.com', signal(), fetcher, now)).status).toBe(
      'malformed',
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects depth above 20 even when the overdeep material would otherwise be redacted', async () => {
    let nested: unknown = 'leaf';
    for (let depth = 0; depth < 21; depth++) nested = { child: nested };
    expect((await lookup({ ...record, entities: nested })).status).toBe('malformed');
  });
  it('rejects more than 20,000 leaves even when they would otherwise be redacted', async () => {
    expect(
      (await lookup({ ...record, notices: Array.from({ length: 20001 }, () => 0) })).status,
    ).toBe('malformed');
  });
  it('settles an ignored fetch on abort and cancels its eventual body', async () => {
    const controller = new AbortController();
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const pending = lookupDomainRegistration('example.com', controller.signal, fetcher, now);
    const assertion = expect(pending).rejects.toThrow('Lookup canceled.');
    controller.abort();
    await assertion;
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ cancel })));
    await Promise.resolve();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('settles stalled body reading on abort even if cancellation never settles', async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetcher = scripted([
      json(bootstrap, 'application/json'),
      new Response(new ReadableStream({ cancel }), {
        headers: { 'Content-Type': 'application/rdap+json' },
      }),
    ]);
    const pending = lookupDomainRegistration('example.com', controller.signal, fetcher, now);
    for (let tick = 0; tick < 30 && fetcher.mock.calls.length < 2; tick++) await Promise.resolve();
    await Promise.resolve();
    const assertion = expect(pending).rejects.toThrow('Lookup canceled.');
    controller.abort();
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });
});
