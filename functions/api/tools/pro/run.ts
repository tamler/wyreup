// POST /api/tools/pro/run
// Reserve-then-refund pattern — see docs/pro-auth-spec.md §10.
//
// Flow: resolve user → validate/prepare → atomic admission/reserve → dispatch →
// on throw, idempotent refund row → otherwise log to run_history.
// Every write is append-only; the ledger never mutates a prior row.

import type { Env } from '../../../_lib/env';
import type { PagesFunction } from '../../../_lib/types';
import { json, requireCsrfHeader, resolveUser, unauthorized } from '../../../_lib/auth';
import { nanoid } from '../../../_lib/crypto';
import { reserveProCredits } from '../../../_lib/limits';
import { priceFor } from '../../../_lib/pricing';
import { prepareProRun, type PreparedProRun } from '../../../_lib/runners';
import { readJsonObject, RequestBodyError } from '../../../_lib/request';

// Largest legitimate input is a 25 MB audio file (~33.3 MB once base64-
// encoded); 36 MB leaves headroom for the JSON envelope. Rejecting early
// while streaming also covers missing or misleading Content-Length.
const MAX_BODY_BYTES = 36 * 1024 * 1024;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();

  const csrfErr = requireCsrfHeader(request, user);
  if (csrfErr) return csrfErr;

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    throw error;
  }
  const toolId = typeof body.toolId === 'string' ? body.toolId : '';
  if (!body.input || typeof body.input !== 'object' || Array.isArray(body.input))
    return json({ error: 'Input object required' }, 400);
  const input = body.input as Record<string, unknown>;

  const creditCost = priceFor(toolId);
  if (creditCost == null) return json({ error: 'Not a PRO tool' }, 400);

  // Local validation must never reserve/refund credits: malformed input
  // otherwise consumes the gross platform cap without any provider work.
  let dispatch: PreparedProRun;
  try {
    dispatch = prepareProRun(toolId, input, env);
  } catch {
    return json({ error: 'Invalid tool input' }, 400);
  }

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
       SELECT ?, ?, 'refund', ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM run_history WHERE spend_event_id = ?)
         AND NOT EXISTS (SELECT 1 FROM credit_events WHERE refund_of = ?)`,
    )
      .bind(
        `evt_${nanoid(16)}`,
        user.id,
        Math.abs(orphan.amount),
        orphan.tool_id,
        orphan.spend_id,
        `Auto-refund for orphan spend ${orphan.spend_id}`,
        Date.now(),
        orphan.spend_id,
        orphan.spend_id,
      )
      .run();
  }

  // 1. Reserve under one write lock with every spend/rate/settings predicate.
  const spendId = `evt_${nanoid(16)}`;
  const now = Date.now();
  const denied = await reserveProCredits(env, {
    userId: user.id,
    cost: creditCost,
    toolId,
    spendId,
    now,
  });
  if (denied) return denied;

  // 2. Run the hosted model. On failure, refund idempotently. The
  //    refund_of column links the refund to its originating spend so the
  //    orphan sweep above can tell handled failures from real crashes.
  let result: unknown;
  try {
    result = await dispatch();
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
