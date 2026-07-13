// GET /api/admin/alerts
// Anomaly check over signup attempts, intended for both the admin dashboard
// and the scheduled monitor (.github/workflows/signup-alerts.yml, which
// authenticates with an admin user's Bearer key). Returns { ok, alerts } —
// ok:false means at least one alert fired. Also prunes create_attempts rows
// older than the retention window so the rate-limit queries stay fast.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json, requireAdmin } from '../../_lib/auth';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 14;
// A day with more allowed signup attempts than this is not organic traffic
// at the current scale; revisit when signups grow.
const ATTEMPTS_24H_ALERT = 50;
const CAPPED_IPS_ALERT = 3;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireAdmin(request, env);
  if (user instanceof Response) return user;

  const now = Date.now();
  const last24h = now - DAY_MS;
  const alerts: { kind: string; message: string }[] = [];

  const attempts24h = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM create_attempts
      WHERE bucket_kind = 'ip' AND attempted_at >= ?`,
  )
    .bind(last24h)
    .first<{ n: number }>();
  const attemptCount = attempts24h?.n ?? 0;
  if (attemptCount >= ATTEMPTS_24H_ALERT) {
    alerts.push({
      kind: 'attempt-volume',
      message: `${attemptCount} signup attempts in the last 24h (alert threshold ${ATTEMPTS_24H_ALERT}).`,
    });
  }

  const cappedIps = await env.DB.prepare(
    `SELECT bucket_val AS ip, COUNT(*) AS n
       FROM create_attempts
      WHERE bucket_kind = 'ip' AND attempted_at >= ?
      GROUP BY bucket_val
     HAVING n >= 10
      ORDER BY n DESC`,
  )
    .bind(last24h)
    .all<{ ip: string; n: number }>();
  const capped = cappedIps.results ?? [];
  if (capped.length >= CAPPED_IPS_ALERT) {
    alerts.push({
      kind: 'capped-ips',
      message: `${capped.length} IPs hit the daily signup cap in the last 24h: ${capped
        .slice(0, 5)
        .map((c) => c.ip)
        .join(', ')}.`,
    });
  }

  // Balance sanity — negative outstanding balance means refunds/chargebacks
  // outran purchases somewhere; worth eyes either way.
  const balance = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS n FROM credit_events`,
  ).first<{ n: number }>();
  if ((balance?.n ?? 0) < 0) {
    alerts.push({
      kind: 'negative-balance',
      message: `Outstanding credit balance is negative (${balance?.n}). Check recent chargebacks.`,
    });
  }

  // Housekeeping: keep the attempts table bounded.
  const pruned = await env.DB.prepare(`DELETE FROM create_attempts WHERE attempted_at < ?`)
    .bind(now - RETENTION_DAYS * DAY_MS)
    .run();

  return json({
    ok: alerts.length === 0,
    checkedAt: now,
    alerts,
    attempts24h: attemptCount,
    cappedIps: capped,
    prunedRows: pruned.meta?.changes ?? 0,
  });
};
