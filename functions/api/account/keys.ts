// GET  /api/account/keys           — list active keys for the user
// POST /api/account/keys           — create new key { name } → returns rawKey once
// POST /api/account/keys/revoke    — revoke { kid }
//
// All require an authenticated user (cookie or Bearer).

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json, requireCsrfHeader, resolveUser, unauthorized } from '../../_lib/auth';
import { generateApiKey, nanoid, sha256hex } from '../../_lib/crypto';

interface ApiKeyRow {
  id: string;
  name: string;
  last_used: number | null;
  created_at: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();

  const rows = await env.DB.prepare(
    `SELECT id, name, last_used, created_at
       FROM api_keys
      WHERE user_id = ? AND revoked_at IS NULL
      ORDER BY created_at ASC`,
  )
    .bind(user.id)
    .all<ApiKeyRow>();

  return json({ keys: rows.results ?? [] });
};

interface CreateBody {
  name?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();

  const csrfErr = requireCsrfHeader(request, user);
  if (csrfErr) return csrfErr;

  const body = (await request.json().catch(() => ({}))) as CreateBody;
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : '';
  if (!name) return json({ error: 'Name required' }, 400);

  // If a session cookie or bearer key is compromised, the attacker can mint
  // additional keys for persistence — revoking the compromised key would not
  // revoke the attacker-created ones. Capping active key count bounds the
  // persistence vector.
  const MAX_ACTIVE_KEYS_PER_USER = 10;
  const activeCount = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL`,
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((activeCount?.n ?? 0) >= MAX_ACTIVE_KEYS_PER_USER) {
    return json(
      { error: `Maximum ${MAX_ACTIVE_KEYS_PER_USER} active keys per account. Revoke an unused key first.` },
      409,
    );
  }

  const keyId = `key_${nanoid(16)}`;
  const rawKey = generateApiKey('wk_live_');
  const keyHash = await sha256hex(rawKey);

  await env.DB.prepare(
    `INSERT INTO api_keys (id, user_id, key_hash, name, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(keyId, user.id, keyHash, name, Date.now())
    .run();

  return json({
    id: keyId,
    name,
    rawKey,
    keyPreview: `${rawKey.slice(0, 12)}…${rawKey.slice(-4)}`,
  });
};
