// Cost-control "oh shit" defenses for the Pro API.
//
// Two new layers on top of the existing infrastructure:
//
//   1. Account-wide daily spend cap — refuses Pro runs once the day's
//      credits-spent across ALL users exceeds the configured cap.
//      Resets at UTC midnight. Catches collective spikes (admin-grant
//      mistakes, silent upstream price changes eating our margin, a
//      runaway integration bug).
//
//   2. Manual emergency kill switch — admin toggle that disables every
//      Pro run immediately, no redeploy.
//
// Per-user spend is already bounded by the existing reserve-INSERT in
// functions/api/tools/pro/run.ts — the conditional `WHERE SUM(amount)
// >= cost` makes it impossible for any single user/api-key to spend
// more credits than the account holds. The 30/min per-account rate
// limit smooths burn within that envelope. No per-user daily cap is
// added here for that reason.
//
// Settings live in the `system_settings` table (migration 0004). Rows
// are lazy: a missing key falls back to the default in DEFAULT_LIMITS.

import type { Env } from './env';
import { json } from './auth';

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
  const n = Number(row.value);
  return Number.isFinite(n) ? n : DEFAULT_LIMITS[key];
}

export async function setSetting(
  env: Env,
  key: LimitKey,
  value: number,
  updatedBy: string,
): Promise<void> {
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
export async function getDailySpendTotal(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(-amount), 0) AS total_spend
       FROM credit_events
      WHERE kind = 'spend' AND created_at >= ?`,
  )
    .bind(startOfUtcDay())
    .first<{ total_spend: number }>();
  return row?.total_spend ?? 0;
}

/**
 * Run the cost-control checks for a Pro run. Returns:
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
): Promise<Response | null> {
  // Read all settings in one round-trip. Missing rows → defaults.
  const rows = await env.DB.prepare(`SELECT key, value FROM system_settings WHERE key IN (?, ?)`)
    .bind(...SETTING_KEYS)
    .all<{ key: string; value: string }>();

  const settings: Record<LimitKey, number> = { ...DEFAULT_LIMITS };
  for (const r of rows.results ?? []) {
    const n = Number(r.value);
    if (Number.isFinite(n) && (SETTING_KEYS as readonly string[]).includes(r.key)) {
      settings[r.key as LimitKey] = n;
    }
  }

  // Layer 2 — kill switch wins, no further queries.
  if (settings.system_disabled !== 0) {
    return json({ error: 'Pro API temporarily disabled. Please try again later.' }, 503);
  }

  // Layer 1 — account-wide daily cap. Cap of 0 disables the layer.
  const cap = settings.daily_spend_cap_credits;
  if (cap <= 0) return null;

  const spent = await getDailySpendTotal(env);
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
