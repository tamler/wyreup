// Shared auth helpers — every authenticated endpoint resolves the caller
// through resolveUser() so the cookie/Bearer split is centralized.
//
// See docs/pro-auth-spec.md §6 + §7.

import type { Env } from './env';
import { isAdminEmail } from './env';
import { parseCookies, sha256hex, verifySessionCookie } from './crypto';

export interface AuthedUser {
  id: string;
  email: string;
  kid: string; // api_keys.id the caller is authenticated as
}

export async function resolveUser(request: Request, env: Env): Promise<AuthedUser | null> {
  // 1. Cookie path (browser)
  const cookies = parseCookies(request.headers.get('Cookie'));
  const sessionCookie = cookies['__Host-wyreup_session'];
  if (sessionCookie) {
    const payload = await verifySessionCookie(sessionCookie, env.SESSION_SECRET);
    if (payload) {
      const row = await env.DB.prepare(
        `SELECT u.id AS uid, u.email
           FROM users u
           JOIN api_keys ak ON ak.user_id = u.id
          WHERE u.id = ? AND ak.id = ? AND ak.revoked_at IS NULL`,
      )
        .bind(payload.uid, payload.kid)
        .first<{ uid: string; email: string }>();
      if (row) return { id: row.uid, email: row.email, kid: payload.kid };
    }
  }

  // 2. Bearer path (CLI / MCP)
  const auth = request.headers.get('Authorization');
  const raw = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!raw) return null;

  const hash = await sha256hex(raw);
  const row = await env.DB.prepare(
    `SELECT ak.id AS kid, ak.user_id AS uid, u.email
       FROM api_keys ak
       JOIN users u ON u.id = ak.user_id
      WHERE ak.key_hash = ? AND ak.revoked_at IS NULL`,
  )
    .bind(hash)
    .first<{ kid: string; uid: string; email: string }>();

  if (!row) return null;

  // Fire-and-forget last_used update
  env.DB.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?')
    .bind(Date.now(), row.kid)
    .run()
    .catch(() => {});

  return { id: row.uid, email: row.email, kid: row.kid };
}

export function unauthorized(): Response {
  return json({ error: 'Unauthorized' }, 401);
}

export function forbidden(): Response {
  return json({ error: 'Forbidden' }, 403);
}

// Resolve the caller and verify they're in the ADMIN_EMAILS allowlist.
// Returns the user when admin, or a Response (401/403) the handler should
// return as-is.
export async function requireAdmin(request: Request, env: Env): Promise<AuthedUser | Response> {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();
  if (!isAdminEmail(user.email, env)) return forbidden();
  return user;
}

export function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

/**
 * Cheap CSRF guard for authenticated state-changing endpoints. Requires
 * the caller to send a custom header. Cross-site browser POSTs cannot
 * set custom headers without a CORS preflight, which we don't ACK — so
 * a forged form post from evil.com is blocked even if SameSite=Lax
 * unexpectedly lets the cookie through (browser quirks, future spec
 * changes).
 *
 * Bypassed for Bearer-authed callers — CLI/MCP send a Bearer header
 * directly, no cookie, no CSRF surface. Only browsers carry cookies
 * cross-site, so the header check is meaningful only for cookie auth.
 */
export function requireCsrfHeader(request: Request, user: AuthedUser): Response | null {
  // Bearer-authed callers (CLI/MCP) — cookie isn't in play, skip.
  if (request.headers.get('Authorization')?.startsWith('Bearer ')) return null;

  const header = request.headers.get('X-Wyreup-CSRF');
  if (header !== '1') {
    return json(
      { error: 'Missing X-Wyreup-CSRF header. Cookie-authed callers must send X-Wyreup-CSRF: 1.' },
      403,
    );
  }
  void user; // reserved for future per-user token; signature kept stable
  return null;
}

export async function getBalance(userId: string, env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS balance
       FROM credit_events
      WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ balance: number }>();
  return row?.balance ?? 0;
}
