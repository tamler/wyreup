const INSTALLED = Symbol.for('@wyreup/cli/egress-installed');
const ORIGINAL = Symbol.for('@wyreup/cli/egress-original-fetch');
const MAX_REDIRECTS = 5;

export class EgressBlockedError extends Error {
  constructor(
    public readonly attempted: string,
    public readonly allowed: readonly string[],
  ) {
    super(`Egress blocked: ${attempted} (only ${allowed.join(', ')} allowed)`);
    this.name = 'EgressBlockedError';
  }
}

async function discardResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Disposal must not replace the redirect's primary result.
  }
}

export function installEgressLock(allowedOrigins: string[]): void {
  const allowed = allowedOrigins.map((o) => new URL(o).origin);
  const allowedSet = new Set(allowed);
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;
  g[ORIGINAL] = globalThis.fetch;
  const original = globalThis.fetch.bind(globalThis);

  const locked = async (
    input: string | Request | URL,
    init: RequestInit = {},
    hops = 0,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!allowedSet.has(url.origin)) throw new EgressBlockedError(url.origin, allowed);

    const userRedirect = request.redirect;
    const response = await original(request, { redirect: 'manual' });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (userRedirect === 'manual') return response;
      let nextRequest: Request;
      try {
        if (userRedirect === 'error') throw new TypeError('redirect not allowed');
        const loc = response.headers.get('location');
        if (!loc) return response;
        if (hops >= MAX_REDIRECTS) throw new EgressBlockedError('max-redirects', allowed);
        const next = new URL(loc, response.url || request.url);
        if (!allowedSet.has(next.origin)) throw new EgressBlockedError(next.origin, allowed);
        const rewrite = ((response.status === 301 || response.status === 302) && request.method === 'POST') ||
          (response.status === 303 && request.method !== 'GET' && request.method !== 'HEAD');
        if (!rewrite && request.body !== null) {
          throw new TypeError('Redirect would replay a request body');
        }
        const headers = new Headers(request.headers);
        if (rewrite) {
          for (const name of ['content-encoding', 'content-language', 'content-location', 'content-type', 'content-length']) {
            headers.delete(name);
          }
        }
        if (next.origin !== url.origin) {
          for (const name of ['authorization', 'cookie', 'proxy-authorization']) headers.delete(name);
        }
        nextRequest = new Request(next, {
          method: rewrite ? 'GET' : request.method, headers, signal: request.signal,
          redirect: userRedirect, credentials: request.credentials, cache: request.cache,
          mode: request.mode, referrer: request.referrer, referrerPolicy: request.referrerPolicy,
          integrity: request.integrity, keepalive: request.keepalive,
        });
      } catch (error) {
        await discardResponse(response);
        throw error;
      }
      await discardResponse(response);
      return locked(nextRequest, {}, hops + 1);
    }
    return response;
  };

  globalThis.fetch = locked;
}

export function _resetEgressLockForTests(): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[ORIGINAL]) globalThis.fetch = g[ORIGINAL] as typeof fetch;
  delete g[INSTALLED];
  delete g[ORIGINAL];
}
