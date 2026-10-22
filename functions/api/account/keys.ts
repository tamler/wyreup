// GET  /api/account/keys           — list active keys for the user
// POST /api/account/keys           — create new key { name } → returns rawKey once
// POST /api/account/keys/revoke    — revoke { kid }
//
// All require an authenticated user (cookie or Bearer).

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json, requireCsrfHeader, resolveUser, unauthorized } from '../../_lib/auth';
import { generateApiKey, nanoid, sha256hex } from '../../_lib/crypto';
import { readJsonObject, RequestBodyError } from '../../_lib/request';

interface ApiKeyRow {
  id: string;
  name: string;
  last_used: number | null;
  created_at: number;
  email_bound: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();

  const rows = await env.DB.prepare(
    `SELECT id, name, last_used, created_at, email_bound
       FROM api_keys
      WHERE user_id = ? AND revoked_at IS NULL
      ORDER BY created_at ASC`,
  )
    .bind(user.id)
    .all<ApiKeyRow>();

  return json({ keys: rows.results ?? [] });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();

  const csrfErr = requireCsrfHeader(request, user);
  if (csrfErr) return csrfErr;

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, 4096);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    throw error;
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : '';
  if (!name) return json({ error: 'Name required' }, 400);

  // If a session cookie or bearer key is compromised, the attacker can mint
  // additional keys for persistence — revoking the compromised key would not
  // revoke the attacker-created ones. Capping active key count bounds the
  // persistence vector.
  const MAX_ACTIVE_KEYS_PER_USER = 10;
  const keyId = `key_${nanoid(16)}`;
  const rawKey = generateApiKey('wk_live_');
  const keyHash = await sha256hex(rawKey);

  const inserted = await env.DB.prepare(
    `INSERT INTO api_keys (id, user_id, key_hash, name, created_at, email_bound)
     SELECT ?, ak.user_id, ?, ?, ?, ak.email_bound FROM api_keys ak
     WHERE ak.id = ? AND ak.user_id = ? AND ak.revoked_at IS NULL AND ak.email_bound = 1
       AND (SELECT COUNT(*) FROM api_keys
            WHERE user_id = ak.user_id AND revoked_at IS NULL AND email_bound = 1) < ?`,
  )
    .bind(keyId, keyHash, name, Date.now(), user.kid, user.id, MAX_ACTIVE_KEYS_PER_USER)
    .run();

  if (inserted.meta.changes !== 1) {
    return json({ error: 'Key could not be created. Check your session or revoke an unused key (maximum 10 active keys).' }, 409);
  }

  return json({
    id: keyId,
    name,
    rawKey,
    keyPreview: `${rawKey.slice(0, 12)}…${rawKey.slice(-4)}`,
  });
};
