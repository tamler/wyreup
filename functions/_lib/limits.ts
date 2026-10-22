// Pro admission checks balance, gross UTC platform spend, rolling request
// rate, failed/pending daily attempts, and the live kill switch atomically.
// Refunds restore customer balances but never erase possible provider cost.
// Missing settings use installation defaults; an invalid existing switch
// fails closed. The admin UI and SQL reservation use the same parsing policy.

import type { Env } from './env';
import { getBalance, json } from './auth';

export const DEFAULT_LIMITS = {
  /**
   * Account-wide credits-spent ceiling per UTC day. 5000 ≈ $50/day cost
   * at 50% margin against ~$0.02/credit revenue. Comfortably above
   * normal usage; well below "wake up to a horror story." Set to 0 to
   * disable the layer entirely.
   */
  daily_spend_cap_credits: 5000,
  /** 1 = Pro API hard-disabled; 0 = enabled. */
  system_disabled: 0,
} as const;

export type LimitKey = keyof typeof DEFAULT_LIMITS;

const SETTING_KEYS: readonly LimitKey[] = ['daily_spend_cap_credits', 'system_disabled'];
const MAX_SETTING = { daily_spend_cap_credits: 10_000_000, system_disabled: 1 } as const;

function parseSetting(key: LimitKey, value: string): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_SETTING[key] && String(n) === value
    ? n
    : key === 'system_disabled'
      ? 1
      : DEFAULT_LIMITS[key];
}

function settingSql(key: LimitKey): string {
  return `COALESCE((SELECT CASE
    WHEN value = CAST(CAST(value AS INTEGER) AS TEXT)
      AND CAST(value AS INTEGER) BETWEEN 0 AND ${MAX_SETTING[key]}
    THEN CAST(value AS INTEGER) ELSE ${key === 'system_disabled' ? 1 : DEFAULT_LIMITS[key]} END
    FROM system_settings WHERE key = '${key}'), ${DEFAULT_LIMITS[key]})`;
}

interface UserLike {
  id: string;
}

/** 00:00 UTC for the day containing `now` (ms since epoch). */
export function startOfUtcDay(now: number = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export async function getSetting(env: Env, key: LimitKey): Promise<number> {
  const row = await env.DB.prepare(`SELECT value FROM system_settings WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  if (!row) return DEFAULT_LIMITS[key];
  return parseSetting(key, row.value);
}

export async function setSetting(
  env: Env,
  key: LimitKey,
  value: number,
  updatedBy: string,
): Promise<void> {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SETTING[key]) {
    throw new Error(`Invalid ${key}`);
  }
  await env.DB.prepare(
    `INSERT INTO system_settings (key, value, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  )
    .bind(key, String(value), Date.now(), updatedBy)
    .run();
}

/** Account-wide credits-spent since 00:00 UTC today. */
export async function getDailySpendTotal(env: Env, now = Date.now()): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(-amount), 0) AS total_spend
       FROM credit_events
      WHERE kind = 'spend' AND created_at >= ?`,
  )
    .bind(startOfUtcDay(now))
    .first<{ total_spend: number }>();
  return row?.total_spend ?? 0;
}

/**
 * Read cost-control status for a denial message. This is not admission:
 * only reserveProCredits may authorize dispatch. Returns:
 *   - null  → all clear, caller proceeds
 *   - Response → return it as-is (status 503)
 *
 * Cost in D1 round-trips: 1 query (settings) when the kill switch is
 * on or the cap is disabled; 2 queries otherwise.
 */
export async function enforceLimits(
  env: Env,
  _user: UserLike,
  costCredits: number,
  now = Date.now(),
): Promise<Response | null> {
  // Read all settings in one round-trip. Missing rows → defaults.
  const rows = await env.DB.prepare(`SELECT key, value FROM system_settings WHERE key IN (?, ?)`)
    .bind(...SETTING_KEYS)
    .all<{ key: string; value: string }>();

  const settings: Record<LimitKey, number> = { ...DEFAULT_LIMITS };
  for (const r of rows.results ?? []) {
    if ((SETTING_KEYS as readonly string[]).includes(r.key)) {
      settings[r.key as LimitKey] = parseSetting(r.key as LimitKey, r.value);
    }
  }

  // Layer 2 — kill switch wins, no further queries.
  if (settings.system_disabled !== 0) {
    return json({ error: 'Pro API temporarily disabled. Please try again later.' }, 503);
  }

  // Layer 1 — account-wide daily cap. Cap of 0 disables the layer.
  const cap = settings.daily_spend_cap_credits;
  if (cap <= 0) return null;

  const spent = await getDailySpendTotal(env, now);
  if (spent + costCredits > cap) {
    return json(
      {
        error: 'Daily platform spend cap reached. The Pro API will resume at 00:00 UTC.',
      },
      503,
    );
  }

  return null;
}

export interface ProReservation {
  userId: string;
  cost: number;
  toolId: string;
  spendId: string;
  now?: number;
}

/** Every admission predicate shares the ledger INSERT's SQLite write lock. */
export async function reserveProCredits(
  env: Env,
  reservation: ProReservation,
): Promise<Response | null> {
  const { userId, cost, toolId, spendId, now = Date.now() } = reservation;
  if (!Number.isSafeInteger(cost) || cost <= 0) throw new Error('Invalid credit cost');
  const day = startOfUtcDay(now);
  const result = await env.DB.prepare(
    `
    INSERT INTO credit_events (id, user_id, kind, amount, tool_id, note, created_at)
    SELECT ?, ?, 'spend', ?, ?, ?, ?
    WHERE ${settingSql('system_disabled')} = 0
      AND (${settingSql('daily_spend_cap_credits')} = 0 OR
        (SELECT COALESCE(SUM(-amount), 0) FROM credit_events WHERE kind='spend' AND created_at >= ?)
        + ? <= ${settingSql('daily_spend_cap_credits')})
      AND (SELECT COALESCE(SUM(amount), 0) FROM credit_events WHERE user_id = ?) >= ?
      AND (SELECT COUNT(*) FROM credit_events WHERE user_id = ? AND kind='spend' AND created_at >= ?) < 30
      AND (SELECT COUNT(*) FROM credit_events spend
        WHERE spend.user_id = ? AND spend.kind='spend' AND spend.created_at >= ?
          AND NOT EXISTS (SELECT 1 FROM run_history WHERE spend_event_id = spend.id)) < 5
  `,
  )
    .bind(
      spendId,
      userId,
      -cost,
      toolId,
      `Ran ${toolId}`,
      now,
      day,
      cost,
      userId,
      cost,
      userId,
      now - 60_000,
      userId,
      day,
    )
    .run();
  if (result.meta.changes === 1) return null;

  // Reads only choose a helpful denial message. They never authorize dispatch.
  const limits = await enforceLimits(env, { id: userId }, cost, now);
  if (limits) return limits;
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM credit_events
    WHERE user_id = ? AND kind='spend' AND created_at >= ?`,
  )
    .bind(userId, now - 60_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 30)
    return json({ error: 'Rate limit: too many PRO runs in the last minute' }, 429);
  const failed = await env.DB.prepare(
    `SELECT COUNT(*) AS n,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM credit_events ref WHERE ref.refund_of=spend.id) THEN 1 ELSE 0 END) AS refunded
    FROM credit_events spend WHERE spend.user_id=? AND spend.kind='spend' AND spend.created_at>=?
      AND NOT EXISTS (SELECT 1 FROM run_history WHERE spend_event_id=spend.id)`,
  )
    .bind(userId, day)
    .first<{ n: number; refunded: number }>();
  if ((failed?.n ?? 0) >= 5) {
    return json(
      {
        error:
          (failed?.refunded ?? 0) >= 5
            ? 'Daily failed-run limit reached. Try again at 00:00 UTC.'
            : 'Too many pending or failed runs. Wait for active runs to finish; failed runs reset at 00:00 UTC.',
      },
      429,
    );
  }
  const balance = await getBalance(userId, env);
  if (balance < cost) return json({ error: 'Insufficient credits', balance }, 402);
  return json({ error: 'Pro admission changed during the request. Please retry.' }, 503);
}
