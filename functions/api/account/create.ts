// POST /api/account/create — signup and recovery share email-only delivery.
import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json } from '../../_lib/auth';
import { generateApiKey, nanoid, sha256hex } from '../../_lib/crypto';
import { sendEmail, welcomeEmail } from '../../_lib/email';
import { readJsonObject, RequestBodyError } from '../../_lib/request';

const DAY_MS = 24 * 60 * 60 * 1000;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, 4096);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    throw error;
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    return json({ error: 'Invalid email' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const now = Date.now();
  const cutoff = now - DAY_MS;
  const attemptId = nanoid();
  // The batch is one transaction. Only the first INSERT admits requests;
  // the second records its IP bucket iff that exact admission succeeded.
  const attempts = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO create_attempts (id, bucket_kind, bucket_val, attempted_at)
       SELECT ?, 'email', ?, ?
       WHERE (SELECT COUNT(*) FROM create_attempts
               WHERE bucket_kind = 'email' AND bucket_val = ? AND attempted_at >= ?) < 5
         AND (SELECT COUNT(*) FROM create_attempts
               WHERE bucket_kind = 'ip' AND bucket_val = ? AND attempted_at >= ?) < 10`,
    ).bind(attemptId, email, now, email, cutoff, ip, cutoff),
    env.DB.prepare(
      `INSERT INTO create_attempts (id, bucket_kind, bucket_val, attempted_at)
       SELECT ?, 'ip', ?, ? WHERE EXISTS (SELECT 1 FROM create_attempts WHERE id = ?)`,
    ).bind(nanoid(), ip, now, attemptId),
  ]);
  if (attempts.some((result) => result.meta.changes !== 1)) {
    return json({ error: 'Too many email requests today. Please try again tomorrow.' }, 429);
  }

  await env.DB.prepare(
    `INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)
     ON CONFLICT(email) DO NOTHING`,
  ).bind(`usr_${nanoid(16)}`, email, now).run();
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email).first<{ id: string }>();
  if (!user) throw new Error('Account creation failed');

  const keyId = `key_${nanoid(16)}`;
  const rawKey = generateApiKey('wk_live_');
  await env.DB.prepare(
    `INSERT INTO api_keys (id, user_id, key_hash, name, created_at, email_bound)
     VALUES (?, ?, ?, 'Email key', ?, 0)`,
  ).bind(keyId, user.id, await sha256hex(rawKey), now).run();

  const sent = await sendEmail(env, { to: email, ...welcomeEmail(rawKey, env) })
    .catch(() => ({ ok: false }));
  if (!sent.ok) {
    await env.DB.prepare('DELETE FROM api_keys WHERE id = ? AND email_bound = 0')
      .bind(keyId).run();
    return json({ error: 'Could not deliver email — please retry' }, 502);
  }
  await env.DB.prepare('UPDATE api_keys SET email_bound = 1 WHERE id = ?')
    .bind(keyId).run();
  // Possession of the mailbox-delivered secret proves ownership. Neither
  // signup nor recovery grants the requesting browser any credential.
  return json({ status: 'check_email' });
};
