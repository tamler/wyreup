// POST /api/admin/users/delete { email }
// Permanently removes an account and everything attached to it (keys, credit
// ledger, run history, saved chains — all FK CASCADE, deleted explicitly
// anyway so the behavior never depends on pragma state). Admin + CSRF only;
// an admin cannot delete their own account.

import type { Env } from '../../../_lib/env';
import type { PagesFunction } from '../../../_lib/types';
import { json, requireAdmin, requireCsrfHeader } from '../../../_lib/auth';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;
  const csrf = requireCsrfHeader(request, admin);
  if (csrf) return csrf;

  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = (body.email || '').trim().toLowerCase();
  if (!email) return json({ error: 'email is required' }, 400);
  if (email === admin.email.toLowerCase()) {
    return json({ error: 'Refusing to delete the signed-in admin account.' }, 400);
  }

  const target = await env.DB.prepare(`SELECT id, email FROM users WHERE LOWER(email) = ?`)
    .bind(email)
    .first<{ id: string; email: string }>();
  if (!target) return json({ error: 'No account with that email.' }, 404);

  const results = await env.DB.batch([
    env.DB.prepare(`DELETE FROM run_history   WHERE user_id = ?`).bind(target.id),
    env.DB.prepare(`DELETE FROM credit_events WHERE user_id = ?`).bind(target.id),
    env.DB.prepare(`DELETE FROM saved_chains  WHERE user_id = ?`).bind(target.id),
    env.DB.prepare(`DELETE FROM api_keys      WHERE user_id = ?`).bind(target.id),
    env.DB.prepare(`DELETE FROM users         WHERE id = ?`).bind(target.id),
  ]);

  return json({
    ok: true,
    deleted: target.email,
    rows: {
      runs: results[0]?.meta?.changes ?? 0,
      creditEvents: results[1]?.meta?.changes ?? 0,
      savedChains: results[2]?.meta?.changes ?? 0,
      keys: results[3]?.meta?.changes ?? 0,
      users: results[4]?.meta?.changes ?? 0,
    },
  });
};
