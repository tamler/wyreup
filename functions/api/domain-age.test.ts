import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { onRequest } from './domain-age';
import type { D1Database, D1PreparedStatement, D1Result, Env } from '../_lib/env';
import type { PagesFunctionContext } from '../_lib/types';
import { validateDomainRegistration } from '../../packages/core/src/lib/domain-registration';

const triggers = [
  'public_api_window_insert',
  'public_api_window_update',
  'public_api_global_full',
  'public_api_network_full',
  'public_api_lease_full',
  'public_api_lease_clock',
];
const result = (changes = 1): D1Result => ({ success: true, meta: { changes } });
const admitted = () => [result(), result(), result()];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

// Scripted D1 wrappers exercise the real admission code, rather than replacing it.
// They do not establish transaction rollback, concurrency, or database-clock guarantees.
function scriptedDatabase(
  options: { admission?: () => Promise<D1Result[]>; cleanup?: D1Result[]; clock?: unknown } = {},
) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const releases = vi.fn(() => Promise.resolve(result()));
  const admissionStarted = deferred<void>();
  class Statement implements D1PreparedStatement {
    values: unknown[] = [];
    constructor(readonly sql: string) {
      queries.push(this);
    }
    bind(...values: unknown[]) {
      this.values = values;
      return this;
    }
    first<T>() {
      return Promise.resolve((options.clock ?? { now_seconds: 125, window_start: 120 }) as T);
    }
    all<T>(): Promise<D1Result<T>> {
      return Promise.resolve({ success: true, meta: {}, results: [] });
    }
    async run<T>(): Promise<D1Result<T>> {
      return (await releases()) as D1Result<T>;
    }
  }
  const prepare = vi.fn((sql: string) => new Statement(sql));
  const batch = vi.fn(async (statements: D1PreparedStatement[]): Promise<D1Result[]> => {
    if ((statements[0] as Statement).sql.startsWith('DELETE')) {
      return (
        options.cleanup ?? [
          result(),
          result(),
          { success: true, meta: {}, results: triggers.map((name) => ({ name })) },
        ]
      );
    }
    admissionStarted.resolve();
    return options.admission ? await options.admission() : admitted();
  });
  const db: D1Database = {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      return (await batch(statements)) as D1Result<T>[];
    },
  };
  return { db, queries, releases, prepare, batch, admissionStarted };
}

function context(
  request: Request,
  db: D1Database | undefined,
  secret = 'SYNTHETIC_SESSION_SECRET_CANARY',
) {
  const pending: Promise<unknown>[] = [];
  const value: PagesFunctionContext = {
    request,
    env: { DB: db, SESSION_SECRET: secret } as Env,
    params: {},
    data: {},
    next: () => Promise.resolve(new Response(null, { status: 404 })),
    waitUntil(promise) {
      pending.push(promise);
    },
  };
  return { value, pending, settle: () => Promise.all(pending) };
}
function request(
  body: BodyInit = JSON.stringify({ domain: 'example.com' }),
  headers: Record<string, string> = {},
) {
  const init: RequestInit & { duplex?: string } = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '198.51.100.10',
      ...headers,
    },
    body,
  };
  if (body instanceof ReadableStream) init.duplex = 'half';
  return new Request('https://wyreup.com/api/domain-age', init);
}
function provider(status = 200) {
  const fetcher = vi.fn<typeof fetch>((url) => {
    const href = url instanceof Request ? url.url : url.toString();
    if (href === 'https://data.iana.org/rdap/dns.json')
      return Promise.resolve(
        new Response(JSON.stringify({ services: [[['com'], ['https://rdap.registry.net/']]] }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    if (href !== 'https://rdap.registry.net/domain/example.com')
      return Promise.reject(new Error('Unexpected upstream URL.'));
    return Promise.resolve(
      new Response(
        status === 200
          ? JSON.stringify({
              objectClassName: 'domain',
              ldhName: 'example.com',
              events: [{ eventAction: 'registration', eventDate: '2000-01-01T00:00:00Z' }],
              entities: [{ registrant: 'REGISTRANT_PRIVATE_CANARY' }],
            })
          : 'UPSTREAM_PRIVATE_CANARY',
        { status, headers: { 'Content-Type': 'application/rdap+json' } },
      ),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
async function security(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Content-Type')).toMatch(/^application\/json/);
  expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  const bytes = await response.text();
  expect(new TextEncoder().encode(bytes).length).toBeLessThanOrEqual(16384);
  expect(bytes).not.toMatch(
    /SYNTHETIC_SESSION_SECRET_CANARY|198\.51\.100|REGISTRANT_PRIVATE_CANARY|UPSTREAM_PRIVATE_CANARY|SQL_PRIVATE_CANARY/,
  );
  return JSON.parse(bytes) as Record<string, unknown>;
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('independent public domain endpoint acceptance with scripted D1 wrappers', () => {
  it.each(['GET', 'OPTIONS', 'PUT'])('rejects %s before database/provider work', async (method) => {
    const database = scriptedDatabase();
    const fetcher = provider();
    const response = await onRequest(
      context(new Request('https://wyreup.com/api/domain-age', { method }), database.db).value,
    );
    await security(response, 405);
    expect(database.prepare).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['https://evil.net', 'https://wyreup.com.evil.net', 'null', 'http://wyreup.com'])(
    'rejects foreign Origin %s before provider/database work',
    async (origin) => {
      const database = scriptedDatabase();
      const fetcher = provider();
      await security(
        await onRequest(context(request(undefined, { Origin: origin }), database.db).value),
        403,
      );
      expect(database.prepare).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, 'https://wyreup.com'])(
    'allows absent or exact same Origin %# with no caller credentials forwarded',
    async (origin) => {
      const database = scriptedDatabase();
      const fetcher = provider();
      const headers = {
        Authorization: 'Bearer AUTH_PRIVATE_CANARY',
        Cookie: 'session=COOKIE_PRIVATE_CANARY',
        ...(origin ? { Origin: origin } : {}),
      };
      const call = context(request(undefined, headers), database.db);
      const output = await security(await onRequest(call.value), 200);
      expect(validateDomainRegistration(output, 'example.com').status).toBe('ok');
      await call.settle();
      expect(database.releases).toHaveBeenCalledOnce();
      expect(
        database.queries.filter(
          (query) =>
            query.sql.includes('DELETE FROM public_api_inflight_leases') && query.values.length,
        ),
      ).toHaveLength(1);
      const admissionQueries = database.queries.filter((query) => query.sql.startsWith('INSERT'));
      expect(admissionQueries).toHaveLength(3);
      expect(admissionQueries[1]?.values[1]).toMatch(/^[0-9a-f]{64}$/);
      expect(admissionQueries[2]?.values[0]).toMatch(/^[0-9a-f]{32}$/);
      expect(JSON.stringify(database.queries)).not.toMatch(
        /example\.com|198\.51\.100|SYNTHETIC_SESSION_SECRET_CANARY/,
      );
      for (const [, init] of fetcher.mock.calls) {
        expect(init?.credentials).toBe('omit');
        expect(init?.redirect).toBe('manual');
        const headerKeys: string[] = [];
        new Headers(init?.headers).forEach((_value, key) => headerKeys.push(key));
        expect(headerKeys).toHaveLength(1);
        expect(new Headers(init?.headers).has('Accept')).toBe(true);
        expect(JSON.stringify(init)).not.toMatch(
          /AUTH_PRIVATE_CANARY|COOKIE_PRIVATE_CANARY|SYNTHETIC_SESSION_SECRET_CANARY/,
        );
      }
      expect(JSON.stringify(output)).not.toContain(String(admissionQueries[2]?.values[0]));
    },
  );
  it.each([
    '{}',
    '[]',
    '{"domain":1}',
    '{"domain":"example.com","url":"https://evil.net/"}',
    '{"domain":"https://example.com"}',
    '{"domain":"127.0.0.1"}',
    '{"domain":"example.com","ip":"198.51.100.2"}',
    'not-json',
  ])('rejects invalid exact input shape %# without database/provider work', async (body) => {
    const database = scriptedDatabase();
    const fetcher = provider();
    await security(await onRequest(context(request(body), database.db).value), 400);
    expect(database.prepare).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    'text/plain',
    'application/json; charset=latin1',
    'application/json; charset=utf-8; x=y',
  ])('rejects request MIME %s', async (media) => {
    const database = scriptedDatabase();
    const fetcher = provider();
    await security(
      await onRequest(context(request(undefined, { 'Content-Type': media }), database.db).value),
      400,
    );
    expect(database.prepare).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('accepts exactly 1024 streamed bytes and rejects 1025 even with false Content-Length', async () => {
    const valid = JSON.stringify({ domain: 'example.com' });
    for (const length of [1024, 1025]) {
      const database = scriptedDatabase();
      const fetcher = provider();
      const cancel = vi.fn();
      const bytes = new TextEncoder().encode(valid + ' '.repeat(length - valid.length));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, 100));
          controller.enqueue(bytes.slice(100));
          if (length === 1024) controller.close();
        },
        cancel,
      });
      const call = context(request(body, { 'Content-Length': '1' }), database.db);
      await security(await onRequest(call.value), length === 1024 ? 200 : 400);
      await call.settle();
      if (length === 1025) {
        expect(cancel).toHaveBeenCalledOnce();
        expect(database.prepare).not.toHaveBeenCalled();
        expect(fetcher).not.toHaveBeenCalled();
      }
    }
  });
  it('rejects oversized actual multibyte bytes with no Content-Length and fatal invalid UTF-8', async () => {
    for (const bytes of [
      new TextEncoder().encode(JSON.stringify({ domain: 'example.com' }) + ' '.repeat(1000) + 'é'),
      new Uint8Array([0xff]),
    ]) {
      const database = scriptedDatabase();
      const fetcher = provider();
      await security(await onRequest(context(request(bytes), database.db).value), 400);
      expect(database.prepare).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
  it.each(['ip', 'secret', 'database'] as const)(
    'fails closed on missing trusted %s',
    async (missing) => {
      const database = scriptedDatabase();
      const fetcher = provider();
      const req = request();
      if (missing === 'ip') req.headers.delete('CF-Connecting-IP');
      const call = context(
        req,
        missing === 'database' ? undefined : database.db,
        missing === 'secret' ? '' : undefined,
      );
      const response = await onRequest(call.value);
      await security(response, 503);
      expect(response.headers.get('Retry-After')).toBe('1');
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['DOMAIN_AGE_GLOBAL_LIMIT', 429],
    ['DOMAIN_AGE_NETWORK_LIMIT', 429],
    ['DOMAIN_AGE_INFLIGHT_LIMIT', 503],
    ['DOMAIN_AGE_WINDOW_CHANGED', 503],
    ['UNIQUE constraint failed SQL_PRIVATE_CANARY', 503],
    ['SQL_PRIVATE_CANARY', 503],
  ] as const)(
    'minimizes admission failure %s without provider I/O or unowned deletion',
    async (message, status) => {
      const database = scriptedDatabase({ admission: () => Promise.reject(new Error(message)) });
      const fetcher = provider();
      const response = await onRequest(context(request(), database.db).value);
      await security(response, status);
      expect(Number(response.headers.get('Retry-After'))).toBe(status === 429 ? 55 : 1);
      expect(fetcher).not.toHaveBeenCalled();
      expect(database.releases).not.toHaveBeenCalled();
      expect(database.batch).toHaveBeenCalledTimes(2);
    },
  );
  it.each([
    { metadata: [result(), result()] },
    { metadata: [result(), result(), result(0)] },
    { metadata: [result(), result(), { success: false, meta: { changes: 1 } }] },
  ])(
    'rejects uncertain admission metadata %# without ownership or provider I/O',
    async ({ metadata }) => {
      const database = scriptedDatabase({ admission: () => Promise.resolve(metadata) });
      const fetcher = provider();
      await security(await onRequest(context(request(), database.db).value), 503);
      expect(fetcher).not.toHaveBeenCalled();
      expect(database.releases).not.toHaveBeenCalled();
      expect(database.batch).toHaveBeenCalledTimes(2);
    },
  );
  it('fails closed on missing triggers before admission and provider I/O', async () => {
    const database = scriptedDatabase({
      cleanup: [
        result(),
        result(),
        { success: true, meta: {}, results: triggers.slice(1).map((name) => ({ name })) },
      ],
    });
    const fetcher = provider();
    await security(await onRequest(context(request(), database.db).value), 503);
    expect(database.batch).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    expect(database.releases).not.toHaveBeenCalled();
  });
  it.each([200, 404, 429, 500])(
    'releases only owned lease after provider status %i',
    async (status) => {
      const database = scriptedDatabase();
      const fetcher = provider(status);
      const call = context(request(), database.db);
      const output = await security(await onRequest(call.value), 200);
      await call.settle();
      expect(output.status).toBe(
        { 200: 'ok', 404: 'not-found', 429: 'rate-limited', 500: 'provider-error' }[status],
      );
      expect(database.releases).toHaveBeenCalledOnce();
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );
  it('starts the ten-second deadline before a stalled request body and requests cancellation', async () => {
    vi.useFakeTimers();
    const database = scriptedDatabase();
    const fetcher = provider();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const call = context(request(new ReadableStream({ cancel })), database.db);
    const pending = onRequest(call.value);
    await vi.advanceTimersByTimeAsync(10000);
    await security(await pending, 503);
    await call.settle();
    expect(cancel).toHaveBeenCalledOnce();
    expect(database.prepare).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['success', 'rejection'] as const)(
    'settles at the original deadline and absorbs late admission %s without provider I/O',
    async (completion) => {
      vi.useFakeTimers();
      const late = deferred<D1Result[]>();
      const database = scriptedDatabase({ admission: () => late.promise });
      const fetcher = provider();
      const call = context(request(), database.db);
      const pending = onRequest(call.value);
      await database.admissionStarted.promise;
      await vi.advanceTimersByTimeAsync(10000);
      await security(await pending, 503);
      expect(fetcher).not.toHaveBeenCalled();
      if (completion === 'success') late.resolve(admitted());
      else late.reject(new Error('SQL_PRIVATE_CANARY'));
      await call.settle();
      expect(fetcher).not.toHaveBeenCalled();
      expect(database.releases).toHaveBeenCalledTimes(completion === 'success' ? 1 : 0);
    },
  );
  it('holds four isolate slots through pending acknowledgement and rejects a fifth without database work', async () => {
    vi.useFakeTimers();
    const late = Array.from({ length: 4 }, () => deferred<D1Result[]>());
    const databases = late.map((value) => scriptedDatabase({ admission: () => value.promise }));
    const fetcher = provider();
    const calls = databases.map((database) => context(request(), database.db));
    const pending = calls.map((call) => Promise.resolve(onRequest(call.value)));
    await Promise.all(databases.map((database) => database.admissionStarted.promise));
    const denied = scriptedDatabase();
    const response = await onRequest(context(request(), denied.db).value);
    await security(response, 503);
    expect(denied.prepare).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    for (const response of await Promise.all(pending)) await security(response, 503);
    const stillDenied = scriptedDatabase();
    await security(await onRequest(context(request(), stillDenied.db).value), 503);
    expect(stillDenied.prepare).not.toHaveBeenCalled();
    late.forEach((value) => value.resolve(admitted()));
    await Promise.all(calls.map((call) => call.settle()));
    expect(fetcher).not.toHaveBeenCalled();
    databases.forEach((database) => expect(database.releases).toHaveBeenCalledOnce());
    const next = scriptedDatabase();
    await security(await onRequest(context(request(), next.db).value), 200);
    expect(next.releases).toHaveBeenCalledOnce();
  });
  it('times out ignored provider fetch and releases owned lease before accepting a late private response', async () => {
    vi.useFakeTimers();
    const database = scriptedDatabase();
    const late = deferred<Response>();
    const started = deferred<void>();
    const fetcher = vi.fn<typeof fetch>(() => {
      started.resolve();
      return late.promise;
    });
    vi.stubGlobal('fetch', fetcher);
    const call = context(request(), database.db);
    const pending = onRequest(call.value);
    await started.promise;
    await vi.advanceTimersByTimeAsync(10000);
    await security(await pending, 503);
    await call.settle();
    expect(database.releases).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    const cancel = vi.fn();
    late.resolve(new Response(new ReadableStream({ cancel })));
    await Promise.resolve();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('independent actual local D1 endpoint admission/release', () => {
  let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
  let db: D1Database;
  beforeAll(async () => {
    platform = await getPlatformProxy<{ DB: D1Database }>({
      configPath: fileURLToPath(
        new URL('../_lib/test/domain-rate-wrangler.jsonc', import.meta.url),
      ),
      persist: false,
    });
    db = platform.env.DB;
    const schema = await readFile(
      new URL('../../migrations/0008_public_domain_limits.sql', import.meta.url),
      'utf8',
    );
    const statements = schema.match(
      /CREATE TABLE[\s\S]*?;\n|CREATE INDEX[^\n]+;\n|CREATE TRIGGER[\s\S]*?END;/g,
    );
    if (
      !statements ||
      statements.length !== 9 ||
      schema
        .replace(/CREATE TABLE[\s\S]*?;\n|CREATE INDEX[^\n]+;\n|CREATE TRIGGER[\s\S]*?END;/g, '')
        .trim()
    )
      throw new Error('The exact migration must contain two tables, one index and six triggers.');
    expect(
      (await db.batch(statements.map((sql) => db.prepare(sql)))).every((value) => value.success),
    ).toBe(true);
  }, 30000);
  beforeEach(async () => {
    await db.batch([
      db.prepare('DELETE FROM public_api_rate_windows'),
      db.prepare('DELETE FROM public_api_inflight_leases'),
    ]);
  });
  afterAll(async () => {
    await platform?.dispose();
  });
  it('admits six real same-network calls, deletes owned leases and rejects the seventh before provider work', async () => {
    const fetcher = provider();
    for (let attempt = 0; attempt < 6; attempt++) {
      const call = context(request(), db);
      await security(await onRequest(call.value), 200);
      await call.settle();
    }
    expect(fetcher).toHaveBeenCalledTimes(7);
    const before = fetcher.mock.calls.length;
    const response = await onRequest(context(request(), db).value);
    await security(response, 429);
    expect(fetcher).toHaveBeenCalledTimes(before);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(Number(response.headers.get('Retry-After'))).toBeLessThanOrEqual(60);
    expect((await db.prepare('SELECT * FROM public_api_inflight_leases').all()).results).toEqual(
      [],
    );
    const counters = (await db.prepare('SELECT * FROM public_api_rate_windows').all()).results;
    expect(counters).toHaveLength(2);
    expect(counters?.every((row) => (row as { count: number }).count === 6)).toBe(true);
    expect(JSON.stringify(counters)).not.toMatch(
      /example\.com|198\.51\.100|SYNTHETIC_SESSION_SECRET_CANARY/,
    );
  }, 30000);
});
