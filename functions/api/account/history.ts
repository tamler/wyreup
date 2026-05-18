// GET /api/account/history — last 20 PRO runs for the authenticated user.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json, resolveUser, unauthorized } from '../../_lib/auth';

interface RunRow {
  tool_id: string;
  credits_used: number;
  file_name: string | null;
  ran_at: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();

  const rows = await env.DB.prepare(
    `SELECT tool_id, credits_used, file_name, ran_at
       FROM run_history
      WHERE user_id = ?
      ORDER BY ran_at DESC
      LIMIT 20`,
  )
    .bind(user.id)
    .all<RunRow>();

  return json({ runs: rows.results ?? [] });
};
