// GET /api/admin/stats
// Summary metrics + recent signups for the admin dashboard.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json, requireAdmin } from '../../_lib/auth';

const DAY_MS = 24 * 60 * 60 * 1000;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const now = Date.now();
  const last7d = now - 7 * DAY_MS;

  // Single-row aggregates first.
  const userTotal = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first<{
    n: number;
  }>();
  const signups7d = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE created_at >= ?`)
    .bind(last7d)
    .first<{ n: number }>();
  const active7d = await env.DB.prepare(
    `SELECT COUNT(DISTINCT user_id) AS n FROM run_history WHERE ran_at >= ?`,
  )
    .bind(last7d)
    .first<{ n: number }>();

  const ledger = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN kind = 'purchase' THEN amount ELSE 0 END) AS purchased,
       SUM(CASE WHEN kind = 'spend'    THEN -amount ELSE 0 END) AS spent,
       SUM(CASE WHEN kind = 'refund'   THEN 1 ELSE 0 END) AS refund_count,
       SUM(CASE WHEN kind = 'bonus'    THEN amount ELSE 0 END) AS bonus,
       COALESCE(SUM(amount), 0) AS balance_outstanding
     FROM credit_events`,
  ).first<{
    purchased: number | null;
    spent: number | null;
    refund_count: number | null;
    bonus: number | null;
    balance_outstanding: number;
  }>();

  // Refund rate per tool over the last 7 days — quick health signal.
  const refundByTool = await env.DB.prepare(
    `SELECT tool_id,
            SUM(CASE WHEN kind = 'spend'  THEN 1 ELSE 0 END) AS runs,
            SUM(CASE WHEN kind = 'refund' THEN 1 ELSE 0 END) AS refunds
       FROM credit_events
      WHERE created_at >= ? AND tool_id IS NOT NULL
      GROUP BY tool_id
      ORDER BY runs DESC`,
  )
    .bind(last7d)
    .all<{ tool_id: string; runs: number; refunds: number }>();

  // Recent signups — last 10 emails so you can see new accounts at a glance.
  const recentSignups = await env.DB.prepare(
    `SELECT id, email, created_at
       FROM users
      ORDER BY created_at DESC
      LIMIT 10`,
  ).all<{ id: string; email: string; created_at: number }>();

  return json({
    users: {
      total: userTotal?.n ?? 0,
      signups7d: signups7d?.n ?? 0,
      active7d: active7d?.n ?? 0,
    },
    credits: {
      purchased: ledger?.purchased ?? 0,
      spent: ledger?.spent ?? 0,
      bonus: ledger?.bonus ?? 0,
      refundCount: ledger?.refund_count ?? 0,
      balanceOutstanding: ledger?.balance_outstanding ?? 0,
    },
    refundsByTool: refundByTool.results ?? [],
    recentSignups: recentSignups.results ?? [],
  });
};
