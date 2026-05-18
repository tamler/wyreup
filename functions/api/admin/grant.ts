// POST /api/admin/grant  { userId, amount, note? }
// Insert a kind='bonus' ledger row to top up an account manually (support
// goodwill, comped users, refund overrides). amount is positive credits.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { json, requireAdmin } from '../../_lib/auth';
import { nanoid } from '../../_lib/crypto';

interface GrantBody {
  userId?: unknown;
  amount?: unknown;
  note?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => ({}))) as GrantBody;
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const amount = typeof body.amount === 'number' ? Math.trunc(body.amount) : NaN;
  const note = typeof body.note === 'string' ? body.note.slice(0, 240) : '';

  if (!userId) return json({ error: 'userId required' }, 400);
  if (!Number.isFinite(amount) || amount === 0) {
    return json({ error: 'amount must be a non-zero integer (negative debits, positive credits)' }, 400);
  }
  if (Math.abs(amount) > 10_000) {
    return json({ error: 'amount cap is 10,000 per grant' }, 400);
  }

  // Confirm the user exists so we don't write orphan ledger rows.
  const userExists = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ id: string }>();
  if (!userExists) return json({ error: 'User not found' }, 404);

  await env.DB.prepare(
    `INSERT INTO credit_events
       (id, user_id, kind, amount, note, created_at)
     VALUES (?, ?, 'bonus', ?, ?, ?)`,
  )
    .bind(
      `evt_${nanoid(16)}`,
      userId,
      amount,
      note || `Admin grant by ${admin.email}`,
      Date.now(),
    )
    .run();

  return json({ ok: true });
};
