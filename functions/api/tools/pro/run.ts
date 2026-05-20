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

// Largest legitimate input is a 25 MB audio file (~33.3 MB once base64-
// encoded); 36 MB leaves headroom for the JSON envelope. Rejecting early
// on Content-Length avoids buffering a huge body before the per-runner
// size caps would catch it. Absent header (chunked encoding) falls
// through — the per-runner caps remain the definitive guard.
const MAX_BODY_BYTES = 36 * 1024 * 1024;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();

  const contentLength = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: 'Request body too large' }, 413);
  }

  const body = (await request.json().catch(() => ({}))) as RunBody;
  const toolId = typeof body.toolId === 'string' ? body.toolId : '';
  const input = (body.input ?? {}) as Record<string, unknown>;

  const creditCost = priceFor(toolId);
  if (creditCost == null) return json({ error: 'Not a PRO tool' }, 400);

  // 0. Per-account rate limit. Stops a stolen key from draining a balance
  // in the time it takes the legitimate owner to notice and revoke.
  // 30 PRO runs in any 60-second window is well above human use but still
  // bounds the worst-case loss to ~150 credits / minute (= $15 at our
  // top-tier rate).
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM credit_events
       WHERE user_id = ? AND kind = 'spend' AND created_at >= ?`,
  )
    .bind(user.id, Date.now() - 60_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 30) {
    return json(
      { error: 'Rate limit: too many PRO runs in the last minute' },
      429,
    );
  }

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
