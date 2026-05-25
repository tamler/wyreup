// POST /api/account/keys/revoke  { kid }
// Soft-revoke a key — sets revoked_at. Cannot un-revoke; user creates a
// new one if they need access again. Refuses to revoke the key the request
// is authenticated with (would lock the user out mid-request).

import type { Env } from '../../../_lib/env';
import type { PagesFunction } from '../../../_lib/types';
import { json, requireCsrfHeader, resolveUser, unauthorized } from '../../../_lib/auth';

interface RevokeBody {
  kid?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();

  const csrfErr = requireCsrfHeader(request, user);
  if (csrfErr) return csrfErr;

  const body = (await request.json().catch(() => ({}))) as RevokeBody;
  const kid = typeof body.kid === 'string' ? body.kid : '';
  if (!kid) return json({ error: 'kid required' }, 400);

  if (kid === user.kid) {
    return json({ error: "Can't revoke the key you're currently using" }, 400);
  }

  const res = await env.DB.prepare(
    `UPDATE api_keys SET revoked_at = ?
      WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
  )
    .bind(Date.now(), kid, user.id)
    .run();

  if ((res.meta.changes ?? 0) !== 1) {
    return json({ error: 'Key not found or already revoked' }, 404);
  }

  return json({ ok: true });
};
