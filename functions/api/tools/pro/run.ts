// POST /api/tools/pro/run
// Reserve-then-refund pattern — see docs/pro-auth-spec.md §10.
//
// The hosted-model call is intentionally a stub for now (`runHostedTool`
// throws "not implemented"). This lets us land the auth + ledger plumbing
// end-to-end, exercise the gate from the browser, and prove the
// reservation+refund cycle works before any model is actually hosted.

import type { Env } from '../../../_lib/env';
import type { PagesFunction } from '../../../_lib/types';
import { getBalance, json, resolveUser, unauthorized } from '../../../_lib/auth';
import { nanoid } from '../../../_lib/crypto';
import { priceFor } from '../../../_lib/pricing';
import { runPro } from '../../../_lib/runners';

interface RunBody {
  toolId?: unknown;
  input?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();

  const body = (await request.json().catch(() => ({}))) as RunBody;
  const toolId = typeof body.toolId === 'string' ? body.toolId : '';
  const input = (body.input ?? {}) as Record<string, unknown>;

  const creditCost = priceFor(toolId);
  if (creditCost == null) return json({ error: 'Not a PRO tool' }, 400);

  // 1. Reserve credits atomically. The INSERT only runs if the current
  //    ledger sum is sufficient. D1 serializes writes per-DB, so concurrent
  //    requests at the boundary are safe — only one will satisfy the WHERE.
  const spendId = `evt_${nanoid(16)}`;
  const now = Date.now();
  const reserved = await env.DB.prepare(
    `INSERT INTO credit_events (id, user_id, kind, amount, tool_id, note, created_at)
     SELECT ?, ?, 'spend', ?, ?, ?, ?
     WHERE (
       SELECT COALESCE(SUM(amount), 0)
         FROM credit_events
        WHERE user_id = ?
     ) >= ?`,
  )
    .bind(
      spendId,
      user.id,
      -creditCost,
      toolId,
      `Ran ${toolId}`,
      now,
      user.id,
      creditCost,
    )
    .run();

  if ((reserved.meta.changes ?? 0) !== 1) {
    const balance = await getBalance(user.id, env);
    return json({ error: 'Insufficient credits', balance }, 402);
  }

  // 2. Run the hosted model. On failure, refund idempotently.
  let result: unknown;
  try {
    result = await runPro(toolId, input, env);
  } catch (err) {
    await env.DB.prepare(
      `INSERT INTO credit_events (id, user_id, kind, amount, tool_id, note, created_at)
       VALUES (?, ?, 'refund', ?, ?, ?, ?)`,
    )
      .bind(
        `evt_${nanoid(16)}`,
        user.id,
        creditCost,
        toolId,
        `Refund for failed run ${spendId}`,
        Date.now(),
      )
      .run();
    return json({ error: 'Run failed', detail: String(err) }, 502);
  }

  // 3. Log run history (no file content, only filename for the user's own UI).
  const fileName =
    typeof input.fileName === 'string' ? (input.fileName as string).slice(0, 256) : null;
  await env.DB.prepare(
    `INSERT INTO run_history (id, user_id, tool_id, tier, credits_used, file_name, ran_at)
     VALUES (?, ?, ?, 'pro', ?, ?, ?)`,
  )
    .bind(`run_${nanoid(16)}`, user.id, toolId, creditCost, fileName, Date.now())
    .run();

  return json({ result });
};
