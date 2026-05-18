// GET /api/admin/runs?limit=50&userId=optional
// Recent PRO runs joined with email for at-a-glance debugging.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json, requireAdmin } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || '50')));
  const userId = url.searchParams.get('userId') || '';

  const params: unknown[] = [];
  let where = '';
  if (userId) {
    where = `WHERE r.user_id = ?`;
    params.push(userId);
  }
  params.push(limit);

  const rows = await env.DB.prepare(
    `SELECT r.id, r.tool_id, r.credits_used, r.file_name, r.ran_at,
            u.email
       FROM run_history r
       JOIN users u ON u.id = r.user_id
       ${where}
      ORDER BY r.ran_at DESC
      LIMIT ?`,
  )
    .bind(...params)
    .all<{
      id: string;
      tool_id: string;
      credits_used: number;
      file_name: string | null;
      ran_at: number;
      email: string;
    }>();

  return json({ runs: rows.results ?? [] });
};
