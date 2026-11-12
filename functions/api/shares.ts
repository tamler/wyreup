// POST /api/shares  { toolId, text }  create a public link for a PRO text result
// GET  /api/shares                    list the caller's active links
//
// Opt-in only: nothing is stored unless the owner asks for a link. Each link
// uses up one paid run of that tool by the same account from the last day,
// creation is capped per day (deleted links count) and per account, and a
// link expires after 30 days. Expired links are deleted in bounded batches.

import type { Env } from '../_lib/env';
import type { PagesFunction } from '../_lib/types';
import { appOrigin } from '../_lib/env';
import { json, requireCsrfHeader, resolveUser, unauthorized } from '../_lib/auth';
import { readJsonObject, RequestBodyError } from '../_lib/request';
import {
  newShareId,
  SHARE_MAX_ACTIVE,
  SHARE_MAX_CHARS,
  SHARE_MAX_CREATES_PER_DAY,
  SHARE_RECENT_RUN_MS,
  SHARE_TTL_MS,
  SHAREABLE_TOOLS,
  shareCleanupStatements,
  shareLinksEnabled,
} from '../_lib/shares';

const disabled = () => json({ error: 'Not found' }, 404);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!shareLinksEnabled(env)) return disabled();
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();
  const csrfErr = requireCsrfHeader(request, user);
  if (csrfErr) return csrfErr;

  let body: Record<string, unknown>;
  try {
    // UTF-8 can need up to 4 bytes per character, plus JSON escaping overhead.
    body = await readJsonObject(request, SHARE_MAX_CHARS * 6 + 4096);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message }, error.status);
    throw error;
  }

  const toolId = typeof body.toolId === 'string' ? body.toolId : '';
  if (!Object.hasOwn(SHAREABLE_TOOLS, toolId)) {
    return json({ error: 'This result type cannot be shared' }, 400);
  }
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) return json({ error: 'Nothing to share' }, 400);
  if (text.length > SHARE_MAX_CHARS) {
    return json({ error: `Shared text is limited to ${SHARE_MAX_CHARS.toLocaleString('en-US')} characters` }, 413);
  }

  const now = Date.now();
  const id = newShareId();
  const expiresAt = now + SHARE_TTL_MS;
  const dayAgo = now - SHARE_RECENT_RUN_MS;
  // One transaction: claim an unused paid run of this tool (the share_creations
  // primary key stops two links using the same run), check the daily and
  // active caps, then store the text only if the claim succeeded. Concurrent
  // requests are serialized by D1, so none can pass a cap together.
  const results = await env.DB.batch([
    ...shareCleanupStatements(env.DB, now),
    env.DB.prepare(
      `INSERT INTO share_creations (run_id, share_id, user_id, created_at)
       SELECT rh.id, ?, rh.user_id, ?
         FROM run_history rh
        WHERE rh.user_id = ? AND rh.tool_id = ? AND rh.ran_at >= ? AND rh.credits_used > 0
          AND NOT EXISTS (SELECT 1 FROM share_creations sc WHERE sc.run_id = rh.id)
          AND (SELECT COUNT(*) FROM share_creations WHERE user_id = ? AND created_at > ?) < ?
          AND (SELECT COUNT(*) FROM shared_results WHERE user_id = ? AND expires_at > ?) < ?
        ORDER BY rh.ran_at DESC
        LIMIT 1`,
    ).bind(
      id,
      now,
      user.id,
      toolId,
      dayAgo,
      user.id,
      dayAgo,
      SHARE_MAX_CREATES_PER_DAY,
      user.id,
      now,
      SHARE_MAX_ACTIVE,
    ),
    env.DB.prepare(
      `INSERT INTO shared_results (id, user_id, tool_id, body, created_at, expires_at)
       SELECT ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM share_creations WHERE share_id = ? AND user_id = ?)`,
    ).bind(id, user.id, toolId, text, now, expiresAt, id, user.id),
  ]);
  if ((results[results.length - 1]?.meta.changes ?? 0) === 1) {
    return json({ id, url: `${appOrigin(env)}/s/${id}`, expiresAt }, 201);
  }

  const usage = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM shared_results WHERE user_id = ? AND expires_at > ?) AS active,
            (SELECT COUNT(*) FROM share_creations WHERE user_id = ? AND created_at > ?) AS today`,
  )
    .bind(user.id, now, user.id, dayAgo)
    .first<{ active: number; today: number }>();
  if ((usage?.active ?? 0) >= SHARE_MAX_ACTIVE) {
    return json(
      { error: `You have ${SHARE_MAX_ACTIVE} active links. Delete one from your account to make another.` },
      429,
    );
  }
  if ((usage?.today ?? 0) >= SHARE_MAX_CREATES_PER_DAY) {
    return json(
      { error: `You created ${SHARE_MAX_CREATES_PER_DAY} links in the last 24 hours. Try again later.` },
      429,
    );
  }
  return json(
    {
      error:
        'Each link needs its own PRO run of this tool from the last 24 hours. Run the tool again to share a new result.',
    },
    403,
  );
};

interface ShareRow {
  id: string;
  tool_id: string;
  body: string;
  created_at: number;
  expires_at: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!shareLinksEnabled(env)) return disabled();
  const user = await resolveUser(request, env);
  if (!user) return unauthorized();

  const now = Date.now();
  const results = await env.DB.batch<ShareRow>([
    ...shareCleanupStatements(env.DB, now),
    // All of the caller's expired links, so opening the account page deletes
    // them even when the shared sweep is busy with older rows. Bounded by the
    // account's own rows, each of which used up a paid run.
    env.DB.prepare(`DELETE FROM shared_results WHERE user_id = ? AND expires_at <= ?`).bind(user.id, now),
    env.DB.prepare(
      `SELECT id, tool_id, substr(body, 1, 80) AS body, created_at, expires_at
         FROM shared_results
        WHERE user_id = ? AND expires_at > ?
        ORDER BY created_at DESC
        LIMIT ?`,
    ).bind(user.id, now, SHARE_MAX_ACTIVE),
  ]);
  const rows = results[results.length - 1];

  const origin = appOrigin(env);
  return json({
    shares: (rows?.results ?? []).map((row) => ({
      id: row.id,
      toolId: row.tool_id,
      preview: row.body,
      url: `${origin}/s/${row.id}`,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    })),
  });
};
