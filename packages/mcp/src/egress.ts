const INSTALLED = Symbol.for('@wyreup/mcp/egress-installed');
const ORIGINAL = Symbol.for('@wyreup/mcp/egress-original-fetch');
const MAX_REDIRECTS = 5;

export class EgressBlockedError extends Error {
  constructor(public readonly attempted: string, public readonly allowed: string) {
    super(`Egress blocked: ${attempted} (only ${allowed} allowed)`);
    this.name = 'EgressBlockedError';
  }
}

function toUrl(input: string | Request | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === 'string') return new URL(input);
  return new URL(input.url);
}

export function installEgressLock(allowedOrigin: string): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;
  g[ORIGINAL] = globalThis.fetch;
  const allowed = new URL(allowedOrigin).origin;
  const original = globalThis.fetch.bind(globalThis);

  const locked = async (input: string | Request | URL, init: RequestInit = {}, hops = 0): Promise<Response> => {
    const url = toUrl(input);
    if (url.origin !== allowed) throw new EgressBlockedError(url.origin, allowed);

    const userRedirect = init.redirect ?? 'follow';
    const response = await original(input, { ...init, redirect: 'manual' });

    if (response.status >= 300 && response.status < 400) {
      if (userRedirect === 'manual') return response;
      if (userRedirect === 'error') throw new TypeError('redirect not allowed');
      if (hops >= MAX_REDIRECTS) throw new EgressBlockedError('max-redirects', allowed);
      const loc = response.headers.get('location');
      if (!loc) return response;
      const next = new URL(loc, response.url);
      if (next.origin !== allowed) throw new EgressBlockedError(next.origin, allowed);
      return locked(next, init, hops + 1);
    }
    return response;
  };

  globalThis.fetch = locked as typeof fetch;
}

// Test-only escape: restores the original fetch and clears the install flag.
export function _resetEgressLockForTests(): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[ORIGINAL]) globalThis.fetch = g[ORIGINAL] as typeof fetch;
  delete g[INSTALLED];
  delete g[ORIGINAL];
}
