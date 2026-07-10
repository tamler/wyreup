// POST /api/tools/pro/run
// Reserve-then-refund pattern — see docs/pro-auth-spec.md §10.
//
// Flow: resolve user → check rate limit → atomic reserve (conditional
// INSERT keyed off SUM(amount) >= cost) → dispatch to runPro() →
// on throw, idempotent refund row → otherwise log to run_history.
// Every write is append-only; the ledger never mutates a prior row.

import type { Env } from '../../../_lib/env';
import type { PagesFunction } from '../../../_lib/types';
import { getBalance, json, requireCsrfHeader, resolveUser, unauthorized } from '../../../_lib/auth';
import { nanoid } from '../../../_lib/crypto';
import { enforceLimits } from '../../../_lib/limits';
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

  const csrfErr = requireCsrfHeader(request, user);
  if (csrfErr) return csrfErr;

  const contentLength = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: 'Request body too large' }, 413);
  }

  const body = (await request.json().catch(() => ({}))) as RunBody;
  const toolId = typeof body.toolId === 'string' ? body.toolId : '';
  const input = (body.input ?? {}) as Record<string, unknown>;

  const creditCost = priceFor(toolId);
  if (creditCost == null) return json({ error: 'Not a PRO tool' }, 400);

  // 0. Cost-control guards: emergency kill switch + account-wide daily
  //    spend cap (see functions/_lib/limits.ts). Runs before the orphan
  //    sweep and rate limit so a tripped switch / blown cap costs us at
  //    most one or two D1 reads, no model dispatch.
  const limitResp = await enforceLimits(env, user, creditCost);
  if (limitResp) return limitResp;

  // 0a. Sweep orphan spend rows from prior mid-handler crashes. A `spend`
  // row with no matching run_history (success) and no matching refund
  // (handled failure) older than 5 minutes means the runtime died between
  // reserve and outcome — auto-refund so the user isn't billed for
  // nothing. The partial UNIQUE index on credit_events(refund_of) keeps
  // this idempotent if it ever races a normal refund path.
  const orphans = await env.DB.prepare(
    `SELECT spend.id AS spend_id, spend.amount AS amount, spend.tool_id AS tool_id
       FROM credit_events spend
       LEFT JOIN run_history rh ON rh.spend_event_id = spend.id
       LEFT JOIN credit_events ref ON ref.refund_of = spend.id
      WHERE spend.user_id = ?
        AND spend.kind = 'spend'
        AND spend.created_at < ?
        AND rh.id IS NULL
        AND ref.id IS NULL
      LIMIT 10`,
  )
    .bind(user.id, Date.now() - 5 * 60 * 1000)
    .all<{ spend_id: string; amount: number; tool_id: string | null }>();
  for (const orphan of orphans.results ?? []) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO credit_events
         (id, user_id, kind, amount, tool_id, refund_of, note, created_at)
       VALUES (?, ?, 'refund', ?, ?, ?, ?, ?)`,
    )
      .bind(
        `evt_${nanoid(16)}`,
        user.id,
        Math.abs(orphan.amount),
        orphan.tool_id,
        orphan.spend_id,
        `Auto-refund for orphan spend ${orphan.spend_id}`,
        Date.now(),
      )
      .run();
  }

  // 0b. Per-account rate limit. Stops a stolen key from draining a balance
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
    return json({ error: 'Rate limit: too many PRO runs in the last minute' }, 429);
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
    .bind(spendId, user.id, -creditCost, toolId, `Ran ${toolId}`, now, user.id, creditCost)
    .run();

  if ((reserved.meta.changes ?? 0) !== 1) {
    const balance = await getBalance(user.id, env);
    return json({ error: 'Insufficient credits', balance }, 402);
  }

  // 2. Run the hosted model. On failure, refund idempotently. The
  //    refund_of column links the refund to its originating spend so the
  //    orphan sweep above can tell handled failures from real crashes.
  let result: unknown;
  try {
    result = await runPro(toolId, input, env);
  } catch (err) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO credit_events
         (id, user_id, kind, amount, tool_id, refund_of, note, created_at)
       VALUES (?, ?, 'refund', ?, ?, ?, ?, ?)`,
    )
      .bind(
        `evt_${nanoid(16)}`,
        user.id,
        creditCost,
        toolId,
        spendId,
        `Refund for failed run ${spendId}`,
        Date.now(),
      )
      .run();

    // Keep full detail server-side. Return only a generic message + a
    // correlation ID; raw error strings may leak internal URLs, model
    // names, prompt fragments, or upstream HTTP details.
    console.error('runPro failed', {
      toolId,
      userId: user.id,
      spendId,
      err: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return json(
      {
        error: 'Run failed',
        requestId: spendId, // operator can grep ops logs for this
      },
      502,
    );
  }

  // 3. Log run history (no file content, only filename for the user's own
  //    UI). The spend_event_id links the success record to its spend row
  //    so the orphan sweep can recognise this as a settled run.
  const fileName = typeof input.fileName === 'string' ? input.fileName.slice(0, 256) : null;
  await env.DB.prepare(
    `INSERT INTO run_history
       (id, user_id, tool_id, tier, credits_used, file_name, ran_at, spend_event_id)
     VALUES (?, ?, ?, 'pro', ?, ?, ?, ?)`,
  )
    .bind(`run_${nanoid(16)}`, user.id, toolId, creditCost, fileName, Date.now(), spendId)
    .run();

  return json({ result });
};
