import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { timingSafeEqualHex } from '../../_lib/crypto';
import { campaignRef, heardAnswer } from '../../_lib/attribution';

const DAY = 86_400_000;
const TOOLS = new Set([
  'transcribe-pro', 'text-summarize-pro', 'text-translate-pro', 'text-sentiment-pro',
  'text-ner-pro', 'text-redact-pro', 'bg-remove-pro', 'upscale-2x-pro', 'ocr-hq',
  'image-describe', 'analyze-chart', 'image-q-and-a', 'read-handwriting', 'detect-objects',
  'translate-image', 'transcribe-and-translate', 'regex-from-text-pro', 'cron-from-text-pro',
  'pdf-summarize', 'pdf-q-and-a', 'text-to-speech-pro', 'content-safety-pro',
  'translate-many-pro', 'translate-document-pro', 'deep-analysis-pro', 'fix-grammar-pro',
  'rewrite-tone-pro', 'chat-long-pdf-pro', 'image-generate-pro', 'json-extract-pro', 'translate-indic-pro',
]);
const STATES = new Set(['active', 'cancelled', 'expired', 'paused']);

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function day(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'GET') return response({ error: 'Method not allowed' }, 405);
  const key = env.OPS_METRICS_KEY ?? '';
  const authorization = request.headers.get('Authorization') ?? '';
  const match = /^Bearer ([0-9a-f]{64})$/.exec(authorization);
  if (!/^[0-9a-f]{64}$/.test(key) || !match || !timingSafeEqualHex(match[1], key)) {
    return response({ error: 'Unauthorized' }, 401);
  }
  const params = new URL(request.url).searchParams;
  const since = params.get('since');
  if ([...params.keys()].length !== 1 || (since !== '24h' && since !== '7d')) {
    return response({ error: 'Invalid window' }, 400);
  }
  const end = Date.now();
  const start = end - (since === '24h' ? DAY : 7 * DAY);
  const fromDay = day(start);
  const throughDay = day(end - 1);
  try {
    const totals = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM users WHERE created_at >= ? AND created_at < ?) AS signups,
      (SELECT COUNT(*) FROM (SELECT user_id, MIN(ran_at) AS first_run FROM run_history GROUP BY user_id) WHERE first_run >= ? AND first_run < ?) AS activations,
      (SELECT COUNT(DISTINCT user_id) FROM run_history WHERE ran_at >= ? AND ran_at < ?) AS dau,
      (SELECT COUNT(DISTINCT user_id) FROM run_history WHERE ran_at >= ? AND ran_at < ?) AS wau,
      (SELECT COALESCE(SUM(amount), 0) FROM credit_events WHERE kind = 'purchase' AND created_at >= ? AND created_at < ?) AS bought,
      (SELECT COALESCE(SUM(-amount), 0) FROM credit_events WHERE kind = 'spend' AND created_at >= ? AND created_at < ?) AS spent,
      (SELECT COALESCE(SUM(amount), 0) FROM credit_events WHERE kind = 'refund' AND refund_of IS NOT NULL AND created_at >= ? AND created_at < ?) AS refunded_credits,
      (SELECT COUNT(*) FROM credit_events WHERE kind = 'refund' AND refund_of IS NOT NULL AND created_at >= ? AND created_at < ?) AS refunded_runs,
      (SELECT COUNT(*) FROM credit_events WHERE kind = 'purchase' AND created_at >= ? AND created_at < ?) AS credit_orders,
      (SELECT COUNT(*) FROM credit_events WHERE kind = 'subscription_grant' AND created_at >= ? AND created_at < ?) AS subscription_invoices`)
      .bind(start, end, start, end, end - DAY, end, end - 7 * DAY, end,
        start, end, start, end, start, end, start, end, start, end, start, end)
      .first<Record<string, number>>();
    if (!totals) throw new Error('missing aggregate');
    const [signups, runs, states, signupRefs, purchaseRefs, daily] = await Promise.all([
      env.DB.prepare(`SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ? GROUP BY day ORDER BY day`).bind(start, end).all<{ day: string; n: number }>(),
      env.DB.prepare(`SELECT tool_id, COUNT(*) AS n FROM run_history WHERE ran_at >= ? AND ran_at < ? GROUP BY tool_id`).bind(start, end).all<{ tool_id: string; n: number }>(),
      env.DB.prepare(`SELECT subscription_status AS state, COUNT(*) AS n FROM users GROUP BY subscription_status`).all<{ state: string | null; n: number }>(),
      env.DB.prepare(`SELECT date(created_at / 1000, 'unixepoch') AS day, signup_ref AS ref, COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ? GROUP BY day, signup_ref`).bind(start, end).all<{ day: string; ref: string | null; n: number }>(),
      env.DB.prepare(`SELECT date(e.created_at / 1000, 'unixepoch') AS day, u.signup_ref AS ref, e.kind, COUNT(*) AS n FROM credit_events e JOIN users u ON u.id = e.user_id WHERE e.kind IN ('purchase', 'subscription_grant') AND e.created_at >= ? AND e.created_at < ? GROUP BY day, u.signup_ref, e.kind`).bind(start, end).all<{ day: string; ref: string | null; kind: string; n: number }>(),
      env.DB.prepare(`SELECT day, kind, label, n FROM attribution_daily WHERE day >= ? AND day <= ? ORDER BY day, kind, label`).bind(fromDay, throughDay).all<{ day: string; kind: string; label: string; n: number }>(),
    ]);
    if ([signups, runs, states, signupRefs, purchaseRefs, daily].some((r) => !r.success)) throw new Error('query failed');
    const runCounts: Record<string, number> = {};
    for (const row of runs.results ?? []) {
      const name = TOOLS.has(row.tool_id) ? row.tool_id : 'other';
      runCounts[name] = (runCounts[name] ?? 0) + row.n;
    }
    const stateCounts: Record<string, number> = {};
    for (const row of states.results ?? []) {
      const state = row.state && STATES.has(row.state) ? row.state : 'other_or_none';
      stateCounts[state] = (stateCounts[state] ?? 0) + row.n;
    }
    const refs = (rows: Array<{ day: string; ref: string | null; n: number; kind?: string }>) => {
      const grouped = new Map<string, { day: string; ref: string; kind?: string; n: number }>();
      for (const row of rows) {
        const ref = campaignRef(row.ref, env) ?? 'unknown';
        const id = `${row.day}:${ref}:${row.kind ?? ''}`;
        const previous = grouped.get(id);
        grouped.set(id, { day: row.day, ref, ...(row.kind ? { kind: row.kind } : {}), n: (previous?.n ?? 0) + row.n });
      }
      return [...grouped.values()];
    };
    const counters = (daily.results ?? []).flatMap((row) => {
      const label = row.kind === 'visit' ? campaignRef(row.label, env) : row.kind === 'heard' ? heardAnswer(row.label) : null;
      return label ? [{ day: row.day, kind: row.kind, label, count: row.n }] : [];
    });
    return response({
      version: 1, product: 'wyreup',
      window: { since, start: new Date(start).toISOString(), end: new Date(end).toISOString(), dailyBucketStart: `${fromDay}T00:00:00.000Z`, dailyBucketEnd: new Date(Date.parse(`${throughDay}T00:00:00Z`) + DAY).toISOString() },
      metrics: {
        signups: { total: totals.signups, byDay: signups.results ?? [], source: null },
        activations: { firstSuccessfulHostedRun: totals.activations },
        activeUsers: { dau: totals.dau, wau: totals.wau },
        runs: { byTool: runCounts },
        credits: { bought: totals.bought, spent: totals.spent, refunded: totals.refunded_credits },
        purchases: { creditOrders: totals.credit_orders, subscriptionInvoices: totals.subscription_invoices },
        subscriptionStates: stateCounts,
        errors: { refundedRuns: totals.refunded_runs, allErrors: null, limitHits: null },
        revenue: null, historicalCancels: null,
        attribution: { signupRefs: refs(signupRefs.results ?? []), purchaseRefs: refs(purchaseRefs.results ?? []), dailyCounters: counters },
      },
      limitations: [
        'Signups are created accounts, including accounts whose email delivery failed.',
        'Active users and activations cover successful hosted Pro runs only; local tools and failed runs are excluded.',
        'Purchases are processed credit orders and subscription invoices, not new subscribers; timestamps are webhook processing times.',
        'Current subscription states are not period churn; financial revenue, complete errors and limit hits are unavailable.',
        'Daily attribution counters include complete UTC boundary days, are capped per tag and day, can include repeated or automated requests, and are not unique visitors.',
        'Attribution is available only for approved labels present at signup; missing and retired labels are unknown.',
      ],
    });
  } catch {
    return response({ error: 'Metrics unavailable' }, 503);
  }
};
