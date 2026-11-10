// POST /api/shares  { toolId, text }  create a public link for a PRO text result
// GET  /api/shares                    list the caller's active links
//
// Opt-in only: nothing is stored unless the owner asks for a link. A link
// needs a run of that tool by the same account in the last day, expires
// after 30 days, and is capped per account.

import type { Env } from '../_lib/env';
import type { PagesFunction } from '../_lib/types';
import { appOrigin } from '../_lib/env';
import { json, requireCsrfHeader, resolveUser, unauthorized } from '../_lib/auth';
import { readJsonObject, RequestBodyError } from '../_lib/request';
import {
  newShareId,
  SHARE_MAX_ACTIVE,
  SHARE_MAX_CHARS,
  SHARE_RECENT_RUN_MS,
  SHARE_TTL_MS,
  SHAREABLE_TOOLS,
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
  const recentRun = await env.DB.prepare(
    `SELECT 1 AS ok FROM run_history WHERE user_id = ? AND tool_id = ? AND ran_at >= ? LIMIT 1`,
  )
    .bind(user.id, toolId, now - SHARE_RECENT_RUN_MS)
    .first<{ ok: number }>();
  if (!recentRun) {
    return json({ error: 'Share links are for results of a PRO run from the last 24 hours' }, 403);
  }

  // The cap is re-checked inside the insert so concurrent requests cannot pass it together.
  const id = newShareId();
  const expiresAt = now + SHARE_TTL_MS;
  const inserted = await env.DB.prepare(
    `INSERT INTO shared_results (id, user_id, tool_id, body, created_at, expires_at)
     SELECT ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM shared_results WHERE user_id = ? AND expires_at > ?) < ?`,
  )
    .bind(id, user.id, toolId, text, now, expiresAt, user.id, now, SHARE_MAX_ACTIVE)
    .run();
  if ((inserted.meta.changes ?? 0) !== 1) {
    return json(
      { error: `You have ${SHARE_MAX_ACTIVE} active links. Delete one from your account to make another.` },
      429,
    );
  }

  return json({ id, url: `${appOrigin(env)}/s/${id}`, expiresAt }, 201);
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

  const rows = await env.DB.prepare(
    `SELECT id, tool_id, substr(body, 1, 80) AS body, created_at, expires_at
       FROM shared_results
      WHERE user_id = ? AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT ?`,
  )
    .bind(user.id, Date.now(), SHARE_MAX_ACTIVE)
    .all<ShareRow>();

  const origin = appOrigin(env);
  return json({
    shares: (rows.results ?? []).map((row) => ({
      id: row.id,
      toolId: row.tool_id,
      preview: row.body,
      url: `${origin}/s/${row.id}`,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    })),
  });
};
