const INSTALLED = Symbol.for('@wyreup/mcp/egress-installed');
const ORIGINAL = Symbol.for('@wyreup/mcp/egress-original-fetch');
// Mutable allowed-origin holder. The locked fetch reads this at call time so
// the worker can narrow/repoint the allowlist to the trusted job.proOrigin
// (delivered via IPC, never via worker env) without reinstalling the hook.
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

function toUrl(input: string | Request | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === 'string') return new URL(input);
  return new URL(input.url);
}

export function installEgressLock(allowedOrigin: string): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  const allowedAtInstall = new URL(allowedOrigin).origin;
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
    const allowed = g[ALLOWED] as string;
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

  globalThis.fetch = locked;
}

/**
 * Repoint the already-installed lock to a single trusted origin. Called by the
 * worker with `job.proOrigin` — a value that arrives over IPC from the parent
 * and is NOT settable via the worker's (scrubbed) environment. This lets a dev
 * who runs the parent against a local backend (WYREUP_ORIGIN=http://localhost)
 * still reach that origin from the worker, WITHOUT exposing an env-overridable
 * allowlist an attacker inside the worker could broaden. No-op if the lock
 * isn't installed yet.
 */
export function setEgressAllowedOrigin(allowedOrigin: string): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (!g[INSTALLED]) return;
  g[ALLOWED] = new URL(allowedOrigin).origin;
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
