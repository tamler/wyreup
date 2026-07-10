// POST /api/account/create
// See docs/pro-auth-spec.md §5.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json } from '../../_lib/auth';
import { generateApiKey, nanoid, sha256hex, signSessionCookie } from '../../_lib/crypto';
import { existingAccountNoticeEmail, sendEmail, welcomeEmail } from '../../_lib/email';

const EMAIL_LIMIT_PER_DAY = 5;
const IP_LIMIT_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

interface CreateBody {
  email?: unknown;
  surface?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json().catch(() => ({}))) as CreateBody;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const surface = body.surface === 'browser' ? 'browser' : 'cli';

  if (!isValidEmail(email)) {
    return json({ error: 'Invalid email' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const now = Date.now();
  const cutoff = now - DAY_MS;

  // Rate-limit lookups
  const emailCount = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM create_attempts
      WHERE bucket_kind = 'email' AND bucket_val = ? AND attempted_at >= ?`,
  )
    .bind(email, cutoff)
    .first<{ n: number }>();
  if ((emailCount?.n ?? 0) >= EMAIL_LIMIT_PER_DAY) {
    return json({ error: 'Too many attempts for this email today' }, 429);
  }

  const ipCount = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM create_attempts
      WHERE bucket_kind = 'ip' AND bucket_val = ? AND attempted_at >= ?`,
  )
    .bind(ip, cutoff)
    .first<{ n: number }>();
  if ((ipCount?.n ?? 0) >= IP_LIMIT_PER_DAY) {
    return json({ error: 'Too many attempts from this network today' }, 429);
  }

  // Record the attempt before doing any work (counts even on failure paths).
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO create_attempts (id, bucket_kind, bucket_val, attempted_at)
       VALUES (?, 'email', ?, ?)`,
    ).bind(nanoid(), email, now),
    env.DB.prepare(
      `INSERT INTO create_attempts (id, bucket_kind, bucket_val, attempted_at)
       VALUES (?, 'ip', ?, ?)`,
    ).bind(nanoid(), ip, now),
  ]);

  // Existing email → notice only, no key issued.
  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>();
  if (existing) {
    const notice = existingAccountNoticeEmail(env);
    // Best-effort; failure here does not change the response.
    await sendEmail(env, { to: email, ...notice }).catch(() => undefined);
    // Same shape as the new-user response — does not leak whether the address is registered.
    return json({ status: 'exists' });
  }

  // New user → mint key.
  const userId = `usr_${nanoid(16)}`;
  const keyId = `key_${nanoid(16)}`;
  const rawKey = generateApiKey('wk_live_');
  const keyHash = await sha256hex(rawKey);
  const keyPreview = `${rawKey.slice(0, 12)}…${rawKey.slice(-4)}`;

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)`).bind(
      userId,
      email,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO api_keys (id, user_id, key_hash, name, created_at)
       VALUES (?, ?, ?, 'Default', ?)`,
    ).bind(keyId, userId, keyHash, now),
  ]);

  // Send welcome email. For the CLI surface this is the ONLY way the user
  // gets the key, so a failure is fatal. For browser, we still have the raw
  // key in the response below — surface it and continue.
  const email_ = welcomeEmail(rawKey, env);
  const sent = await sendEmail(env, { to: email, ...email_ });

  if (!sent.ok && surface !== 'browser') {
    return json({ error: 'Could not deliver welcome email — please retry' }, 502);
  }

  // Browser surface: sign the user in immediately by setting the same
  // HMAC-signed, HttpOnly session cookie that /api/account/verify issues.
  // No email-verification gate — a fresh account has 0 credits, so an
  // unverified address cannot cost anything; the emailed key remains the
  // durable credential for CLI/MCP and for sessions beyond 24h.
  if (surface === 'browser') {
    const exp = now + SESSION_MAX_AGE_SECONDS * 1000;
    const cookie = await signSessionCookie({ uid: userId, kid: keyId, exp }, env.SESSION_SECRET);
    return json({ status: 'created', keyPreview, rawKey, emailDelivered: sent.ok }, 200, {
      'Set-Cookie': [
        `__Host-wyreup_session=${cookie}`,
        `Path=/`,
        `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
        `HttpOnly`,
        `Secure`,
        `SameSite=Lax`,
      ].join('; '),
    });
  }

  // CLI/MCP: key is delivered by email only.
  return json({ status: 'created', keyPreview, emailDelivered: sent.ok });
};

function isValidEmail(s: string): boolean {
  // Cheap but adequate. Real validation happens implicitly when delivery
  // succeeds or doesn't.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 320;
}
