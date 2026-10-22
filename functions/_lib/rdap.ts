import {
  canonicalizeDomain,
  domainStatusResult,
  extractRegistrationAge,
  registrationInstant,
  type DomainRegistration,
} from '../../packages/core/src/lib/domain-registration';
import { cloneUtilityJson } from '../../packages/core/src/utilities/common';

const BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
const MAX_BODY = 1024 * 1024;
export interface RdapService {
  suffix: string;
  bases: string[];
}
type Fetcher = typeof fetch;
const cache = new WeakMap<Fetcher, { services: RdapService[]; expires: number }>();

function publicBase(value: string): URL | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith('/')
    )
      return null;
    const host = canonicalizeDomain(url.hostname);
    if (
      host !== url.hostname ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example|home|lan|onion)$/.test(host)
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

export function parseBootstrap(value: unknown): RdapService[] {
  const data = cloneUtilityJson(value, '$bootstrap');
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.services))
    throw new Error('Invalid bootstrap.');
  const services = new Map<string, string[]>();
  for (const service of data.services) {
    if (
      !Array.isArray(service) ||
      service.length !== 2 ||
      !Array.isArray(service[0]) ||
      !Array.isArray(service[1]) ||
      !service[0].length ||
      !service[1].length
    )
      throw new Error('Invalid bootstrap service.');
    const bases = service[1];
    if (bases.some((base) => typeof base !== 'string' || base.length > 2048))
      throw new Error('Invalid bootstrap base.');
    for (const key of service[0]) {
      if (typeof key !== 'string' || !key || key.endsWith('.'))
        throw new Error('Invalid bootstrap suffix.');
      const suffix = canonicalizeDomain('d.' + key).slice(2);
      const previous = services.get(suffix);
      if (previous && JSON.stringify(previous) !== JSON.stringify(bases))
        throw new Error('Conflicting bootstrap suffix.');
      if (!previous) services.set(suffix, [...bases] as string[]);
    }
  }
  return [...services].map(([suffix, bases]) => ({ suffix, bases }));
}

export function selectRdapSource(services: RdapService[], domain: string): URL | null {
  if (canonicalizeDomain(domain) !== domain) throw new Error('Expected canonical domain.');
  const matching = services.filter(
    (service) => domain === service.suffix || domain.endsWith('.' + service.suffix),
  );
  matching.sort((a, b) => b.suffix.length - a.suffix.length);
  const service = matching[0];
  if (!service) return null;
  for (const candidate of service.bases) {
    const base = publicBase(candidate);
    if (base) return new URL('domain/' + domain, base);
  }
  return null;
}

function cancel(body: ReadableStream<Uint8Array> | null): void {
  try {
    if (body) void body.cancel().catch(() => {});
  } catch {
    /* A locked body is canceled by its reader. */
  }
}

async function abortable<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  if (signal.aborted) {
    void pending.then(
      (value) => late?.(value),
      () => {},
    );
    throw new Error('Lookup canceled.');
  }
  let abandoned = false;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      abandoned = true;
      reject(new Error('Lookup canceled.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const tracked = pending.then((value) => {
    if (abandoned) late?.(value);
    return value;
  });
  try {
    return await Promise.race([tracked, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function mediaMatches(value: string | null, expected: string): boolean {
  return (
    value !== null &&
    new RegExp(
      '^\\s*' +
        expected.replace('+', '\\+') +
        '(?:\\s*;\\s*charset\\s*=\\s*(?:utf-8|"utf-8"))?\\s*$',
      'i',
    ).test(value)
  );
}

async function readJson(response: Response, media: string, signal: AbortSignal): Promise<unknown> {
  if (!mediaMatches(response.headers.get('Content-Type'), media) || !response.body) {
    cancel(response.body);
    throw new Error('Invalid provider media.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const onAbort = () => {
    try {
      void reader.cancel().catch(() => {});
    } catch {
      /* Cancellation is best effort. */
    }
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      const next = await abortable(reader.read(), signal);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY) throw new Error('Provider response exceeds limit.');
      chunks.push(next.value);
    }
    if (signal.aborted) throw new Error('Lookup canceled.');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return cloneUtilityJson(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      '$provider',
    );
  } finally {
    signal.removeEventListener('abort', onAbort);
    onAbort();
    try {
      reader.releaseLock();
    } catch {
      /* A pending abandoned read may retain its lock. */
    }
  }
}

async function request(
  url: URL | string,
  accept: string,
  signal: AbortSignal,
  fetcher: Fetcher,
): Promise<Response> {
  if (signal.aborted) throw new Error('Lookup canceled.');
  return abortable(
    fetcher(url, {
      method: 'GET',
      headers: { Accept: accept },
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal,
    }),
    signal,
    (response) => cancel(response.body),
  );
}

export async function lookupDomainRegistration(
  domain: string,
  signal: AbortSignal,
  fetcher: Fetcher = fetch,
  now: () => ReturnType<typeof registrationInstant> = () =>
    registrationInstant(new Date().toISOString()),
  onRateLimit?: (retryAfter: number) => void,
): Promise<DomainRegistration> {
  if (canonicalizeDomain(domain) !== domain) throw new Error('Expected canonical domain.');
  const observedAt = now();
  let source: URL | null = null;
  try {
    let cached = cache.get(fetcher);
    if (!cached || cached.expires <= Date.now()) {
      const response = await request(BOOTSTRAP, 'application/json', signal, fetcher);
      if (response.status !== 200) {
        cancel(response.body);
        return domainStatusResult(domain, 'provider-error', observedAt);
      }
      const services = parseBootstrap(await readJson(response, 'application/json', signal));
      cached = { services, expires: Date.now() + 86400000 };
      cache.set(fetcher, cached);
    }
    source = selectRdapSource(cached.services, domain);
    if (!source) return domainStatusResult(domain, 'unsupported-tld', observedAt);
    let current = source;
    for (let redirects = 0; ; redirects++) {
      const response = await request(current, 'application/rdap+json', signal, fetcher);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        cancel(response.body);
        const location = response.headers.get('Location');
        if (!location || location.length > 2048 || redirects >= 2)
          return domainStatusResult(
            domain,
            'unsupported-redirect',
            observedAt,
            source.hostname,
            source.href,
          );
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return domainStatusResult(
            domain,
            'unsupported-redirect',
            observedAt,
            source.hostname,
            source.href,
          );
        }
        if (
          next.protocol !== 'https:' ||
          next.origin !== source.origin ||
          next.pathname !== source.pathname ||
          next.username ||
          next.password ||
          next.search ||
          next.hash
        )
          return domainStatusResult(
            domain,
            'unsupported-redirect',
            observedAt,
            source.hostname,
            source.href,
          );
        current = next;
        continue;
      }
      if (response.status !== 200) {
        cancel(response.body);
        if (response.status === 429) {
          const value = response.headers.get('Retry-After') ?? '';
          onRateLimit?.(/^\d{1,8}$/.test(value) ? Math.max(1, Math.min(60, Number(value))) : 60);
        }
        return domainStatusResult(
          domain,
          response.status === 404
            ? 'not-found'
            : response.status === 429
              ? 'rate-limited'
              : 'provider-error',
          observedAt,
          source.hostname,
          source.href,
        );
      }
      try {
        return extractRegistrationAge(
          await readJson(response, 'application/rdap+json', signal),
          domain,
          observedAt,
          source.hostname,
          source.href,
        );
      } catch {
        if (signal.aborted) throw new Error('Lookup canceled.');
        return domainStatusResult(domain, 'malformed', observedAt, source.hostname, source.href);
      }
    }
  } catch {
    if (signal.aborted) throw new Error('Lookup canceled.');
    return domainStatusResult(
      domain,
      'provider-error',
      observedAt,
      source?.hostname ?? null,
      source?.href ?? null,
    );
  }
}
