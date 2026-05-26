// GET  /api/admin/limits → current settings + today's account-wide spend
// POST /api/admin/limits → upsert one or more cost-control settings
//
// Backs the Limits/Kill-Switch panel in AdminDashboard.svelte. The
// runtime guards driven by these settings live in functions/_lib/
// limits.ts and are wired into /api/tools/pro/run.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json, requireAdmin, requireCsrfHeader } from '../../_lib/auth';
import {
  DEFAULT_LIMITS,
  getDailySpendTotal,
  getSetting,
  setSetting,
  type LimitKey,
} from '../../_lib/limits';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const [dailyCap, systemDisabled, todaySpend] = await Promise.all([
    getSetting(env, 'daily_spend_cap_credits'),
    getSetting(env, 'system_disabled'),
    getDailySpendTotal(env),
  ]);

  return json({
    settings: {
      daily_spend_cap_credits: dailyCap,
      system_disabled: systemDisabled,
    },
    defaults: DEFAULT_LIMITS,
    todaySpend,
  });
};

interface UpdateBody {
  daily_spend_cap_credits?: unknown;
  system_disabled?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const csrfErr = requireCsrfHeader(request, admin);
  if (csrfErr) return csrfErr;

  const body = (await request.json().catch(() => ({}))) as UpdateBody;

  const updates: Array<[LimitKey, number]> = [];

  if (body.daily_spend_cap_credits !== undefined) {
    const n =
      typeof body.daily_spend_cap_credits === 'number'
        ? Math.trunc(body.daily_spend_cap_credits)
        : NaN;
    if (!Number.isFinite(n) || n < 0) {
      return json({ error: 'daily_spend_cap_credits must be a non-negative integer' }, 400);
    }
    // Sanity ceiling — a typo here could disable the layer in practice.
    if (n > 10_000_000) {
      return json({ error: 'daily_spend_cap_credits exceeds 10,000,000' }, 400);
    }
    updates.push(['daily_spend_cap_credits', n]);
  }

  if (body.system_disabled !== undefined) {
    const v = body.system_disabled;
    // Accept 0/1 number or boolean; nothing else.
    let n: number;
    if (v === 0 || v === 1) n = v;
    else if (v === true) n = 1;
    else if (v === false) n = 0;
    else return json({ error: 'system_disabled must be 0, 1, or boolean' }, 400);
    updates.push(['system_disabled', n]);
  }

  if (updates.length === 0) {
    return json({ error: 'No recognized settings in body' }, 400);
  }

  for (const [key, value] of updates) {
    await setSetting(env, key, value, admin.id);
  }

  return json({ ok: true, updated: Object.fromEntries(updates) });
};
