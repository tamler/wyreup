const INSTALLED = Symbol.for('@wyreup/mcp/egress-installed');
const ORIGINAL = Symbol.for('@wyreup/mcp/egress-original-fetch');
// Mutable allowed-origin holder. The locked fetch reads this at call time so
// the worker can configure the trusted origins delivered in its IPC job
// without reinstalling the hook.
const ALLOWED = Symbol.for('@wyreup/mcp/egress-allowed-origin');
const MAX_REDIRECTS = 5;

export class EgressBlockedError extends Error {
  constructor(
    public readonly attempted: string,
    public readonly allowed: string,
  ) {
    super(`Egress blocked: ${attempted} (only ${allowed} allowed)`);
    this.name = 'EgressBlockedError';
  }
}

function normalizeOrigins(origins: string | readonly string[]): Set<string> {
  const values = typeof origins === 'string' ? [origins] : origins;
  return new Set(values.map((origin) => new URL(origin).origin));
}

function describeOrigins(origins: ReadonlySet<string>): string {
  return Array.from(origins).join(', ');
}

async function discardResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Disposal must not replace the redirect's primary result.
  }
}

export function installEgressLock(allowedOrigins: string | readonly string[]): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  const allowedAtInstall = normalizeOrigins(allowedOrigins);
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;
  g[ORIGINAL] = globalThis.fetch;
  g[ALLOWED] = allowedAtInstall;
  const original = globalThis.fetch.bind(globalThis);

  const locked = async (
    input: string | Request | URL,
    init: RequestInit = {},
    hops = 0,
  ): Promise<Response> => {
    const allowed = g[ALLOWED] as Set<string>;
    const allowedDescription = describeOrigins(allowed);
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!allowed.has(url.origin)) {
      throw new EgressBlockedError(url.origin, allowedDescription);
    }

    const userRedirect = request.redirect;
    const response = await original(request, { redirect: 'manual' });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (userRedirect === 'manual') return response;
      let nextRequest: Request;
      try {
        if (userRedirect === 'error') throw new TypeError('redirect not allowed');
        const loc = response.headers.get('location');
        if (!loc) return response;
        if (hops >= MAX_REDIRECTS) throw new EgressBlockedError('max-redirects', allowedDescription);
        const next = new URL(loc, response.url || request.url);
        if (!allowed.has(next.origin)) throw new EgressBlockedError(next.origin, allowedDescription);
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

/**
 * Replace the already-installed lock's trusted origins. The worker receives
 * these values over IPC from the parent rather than from its scrubbed
 * environment, so model downloads and Pro calls work without exposing an
 * env-controlled allowlist inside the process that holds the Pro key.
 */
export function setEgressAllowedOrigins(allowedOrigins: string | readonly string[]): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (!g[INSTALLED]) return;
  g[ALLOWED] = normalizeOrigins(allowedOrigins);
}

/** Backwards-compatible single-origin helper. */
export function setEgressAllowedOrigin(allowedOrigin: string): void {
  setEgressAllowedOrigins(allowedOrigin);
}

// Test-only escape: restores the original fetch and clears the install flag.
// Guarded so a third party importing the built bundle cannot disable the lock
// in production — it is inert unless a real test runner is active.
function isTestEnv(): boolean {
  return process.env['VITEST'] !== undefined || process.env['NODE_ENV'] === 'test';
}

export function _resetEgressLockForTests(): void {
  if (!isTestEnv()) return;
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[ORIGINAL]) globalThis.fetch = g[ORIGINAL] as typeof fetch;
  delete g[INSTALLED];
  delete g[ORIGINAL];
  delete g[ALLOWED];
}
