// GET /api/admin/users?q=email&limit=50&offset=0
// Paginated account list with derived balance + lifetime stats.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json, requireAdmin } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || '50')));
  const offset = Math.max(0, Number(url.searchParams.get('offset') || '0'));

  // LEFT JOIN aggregating the ledger — fine up to a few thousand users.
  // When this gets slow, add a materialized balance column updated by triggers.
  const params: unknown[] = [];
  let where = '';
  if (q) {
    where = `WHERE LOWER(u.email) LIKE ?`;
    params.push(`%${q}%`);
  }
  params.push(limit, offset);

  const rows = await env.DB.prepare(
    `SELECT u.id, u.email, u.created_at, u.last_seen,
            COALESCE(SUM(c.amount), 0) AS balance,
            COALESCE(SUM(CASE WHEN c.kind='purchase' THEN c.amount END), 0) AS purchased,
            COALESCE(SUM(CASE WHEN c.kind='spend'    THEN -c.amount END), 0) AS spent,
            COALESCE(SUM(CASE WHEN c.kind='bonus'    THEN c.amount END), 0) AS bonus
       FROM users u
       LEFT JOIN credit_events c ON c.user_id = u.id
       ${where}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?`,
  )
    .bind(...params)
    .all<{
      id: string;
      email: string;
      created_at: number;
      last_seen: number | null;
      balance: number;
      purchased: number;
      spent: number;
      bonus: number;
    }>();

  return json({ users: rows.results ?? [] });
};
