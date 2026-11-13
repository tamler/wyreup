import type { Env } from './env';
import { json } from './auth';
import { hmacSha256Hex, nanoid } from './crypto';
import { explainProDenial, prepareProReservation, type ProReservation } from './limits';

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MANAGED_DEADLINE_MS = 210_000;
// Exceeds the whole-run server deadline, leaving time for settlement.
const STALE_SECONDS = MANAGED_DEADLINE_MS / 1000 + 60;
const MANAGED = new Set(['document-to-markdown-pro', 'receipt-batch-to-csv-pro', 'image-edit-pro']);

interface RequestRow {
  request_key: string;
  tool_id: string;
  input_digest: string;
  digest_version: number;
  owner_id: string;
  spend_id: string;
  state: 'reserved' | 'dispatching' | 'completed' | 'failed_refunded' | 'unknown_refunded';
}

export function requiresRequestKey(toolId: string): boolean { return MANAGED.has(toolId); }
export function validRequestKey(key: unknown): key is string {
  return typeof key === 'string' && KEY.test(key);
}

function validSecret(env: Env): boolean { return typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length > 0; }

async function hashString(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

// Hash each string independently before constructing a canonical representation.
// This avoids copying a whole multi-file request into the HMAC input a second time.
async function canonical(value: unknown, depth = 0): Promise<unknown> {
  if (depth > 32) throw new Error('Input nesting exceeds limit');
  if (typeof value === 'string') return ['string', await hashString(value)];
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) {
    if (value.length > 128) throw new Error('Input array exceeds limit');
    const items = [];
    for (const item of value) items.push(await canonical(item, depth + 1));
    return items;
  }
  if (typeof value === 'object') {
    const entries: unknown[] = [];
    const keys = Object.keys(value).sort();
    if (keys.length > 128 || keys.some(key => key.length > 128)) throw new Error('Input object exceeds limit');
    for (const key of keys) {
      entries.push([key, await canonical((value as Record<string, unknown>)[key], depth + 1)]);
    }
    return ['object', entries];
  }
  throw new Error('Unsupported input');
}

async function digest(env: Env, userId: string, toolId: string, input: Record<string, unknown>): Promise<string> {
  return hmacSha256Hex(env.SESSION_SECRET, JSON.stringify(['wyreup:pro-request:v1', userId, toolId, await canonical(input)]));
}

async function getRow(env: Env, userId: string, key: string): Promise<RequestRow | null> {
  return env.DB.prepare('SELECT request_key,tool_id,input_digest,digest_version,owner_id,spend_id,state FROM pro_requests WHERE user_id=? AND request_key=?')
    .bind(userId, key).first<RequestRow>();
}

function status(row: RequestRow): Response {
  const [code, error] = row.state === 'completed'
    ? ['request_completed_no_replay', 'This request completed; its result is not stored for replay.']
    : row.state === 'unknown_refunded'
      ? ['request_outcome_unknown', 'This request timed out and was refunded; its provider outcome is unknown.']
      : row.state === 'failed_refunded'
      ? ['request_failed_refunded', 'This request failed or timed out and was refunded.']
      : ['request_in_progress', 'This request is pending. Check its status using the same request key.'];
  return json({ code, error, requestKey: row.request_key }, 409, code === 'request_in_progress' ? { 'Retry-After': '5' } : {});
}

export async function recoverStale(env: Env, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE pro_requests SET state='unknown_refunded', updated_at=unixepoch()
      WHERE rowid IN (SELECT rowid FROM pro_requests WHERE user_id=? AND state IN ('reserved','dispatching')
        AND updated_at <= unixepoch() - ? LIMIT 10)`).bind(userId, STALE_SECONDS),
    env.DB.prepare(`INSERT OR IGNORE INTO credit_events (id,user_id,kind,amount,tool_id,refund_of,note,created_at)
      SELECT 'evt_' || lower(hex(randomblob(16))),p.user_id,'refund',-s.amount,p.tool_id,p.spend_id,'Refund for expired managed request',unixepoch()*1000
      FROM pro_requests p JOIN credit_events s ON s.id=p.spend_id
      WHERE p.user_id=? AND p.state='unknown_refunded' AND NOT EXISTS
        (SELECT 1 FROM credit_events r WHERE r.refund_of=p.spend_id)`).bind(userId),
  ]);
}

export async function managedStatus(env: Env, userId: string, key: unknown): Promise<Response> {
  if (!validRequestKey(key)) return json({ code: 'request_key_required', error: 'A valid request key is required.' }, 400);
  const normalizedKey = key.toLowerCase();
  try {
    await recoverStale(env, userId);
    const row = await getRow(env, userId, normalizedKey);
    return row ? status(row) : json({ code: 'request_not_found', error: 'No request exists for this key.' }, 404);
  } catch {
    return json({ code: 'request_outcome_unknown', error: 'Could not check request status.', requestKey: normalizedKey }, 503);
  }
}

export async function admitManaged(env: Env, userId: string, key: string, toolId: string, input: Record<string, unknown>, cost: number): Promise<{ response: Response } | { row: RequestRow }> {
  if (!validSecret(env)) return { response: json({ code: 'request_unavailable', error: 'Pro request protection is unavailable.' }, 503) };
  let inputDigest: string;
  try { inputDigest = await digest(env, userId, toolId, input); }
  catch { return { response: json({ code: 'invalid_input', error: 'Invalid request input.' }, 400) }; }
  const owner = `owner_${nanoid(16)}`;
  const reservation: ProReservation = { userId, cost, toolId, spendId: `evt_${nanoid(16)}` };
  try {
    await recoverStale(env, userId);
    const result = await env.DB.batch<RequestRow>([
      prepareProReservation(env, reservation, key),
      env.DB.prepare(`INSERT INTO pro_requests (user_id,request_key,tool_id,input_digest,digest_version,owner_id,spend_id,state,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,'reserved',unixepoch(),unixepoch()
        WHERE EXISTS (SELECT 1 FROM credit_events WHERE id=? AND user_id=?)
        ON CONFLICT(user_id,request_key) DO NOTHING`)
        .bind(userId, key, toolId, inputDigest, 1, owner, reservation.spendId, reservation.spendId, userId),
      env.DB.prepare('SELECT request_key,tool_id,input_digest,digest_version,owner_id,spend_id,state FROM pro_requests WHERE user_id=? AND request_key=?').bind(userId, key),
    ]);
    const row = result[2]?.results?.[0];
    if (!row) return { response: await explainProDenial(env, reservation) };
    if (row.tool_id !== toolId || row.digest_version !== 1 || row.input_digest !== inputDigest)
      return { response: json({ code: 'request_key_conflict', error: 'Request key was already used for different input.', requestKey: key }, 409) };
    if (row.owner_id !== owner || row.spend_id !== reservation.spendId) return { response: status(row) };
    const claimed = await env.DB.prepare(`UPDATE pro_requests SET state='dispatching',updated_at=unixepoch()
      WHERE user_id=? AND request_key=? AND owner_id=? AND state='reserved'`)
      .bind(userId, key, owner).run();
    if (claimed.meta.changes !== 1) return { response: json({ code: 'request_outcome_unknown', error: 'Request outcome is unknown. Check its status.', requestKey: key }, 503) };
    return { row: { ...row, state: 'dispatching' } };
  } catch {
    return { response: json({ code: 'request_outcome_unknown', error: 'Request outcome is unknown. Check its status.', requestKey: key }, 503) };
  }
}

export async function settleManaged(env: Env, userId: string, row: RequestRow, success: boolean, cost: number, attempt = 0): Promise<boolean> {
  const target = success ? 'completed' : 'failed_refunded';
  try {
    const statements = success ? [
      env.DB.prepare(`INSERT INTO run_history(id,user_id,tool_id,tier,credits_used,file_name,ran_at,spend_event_id)
        SELECT ?,p.user_id,p.tool_id,'pro',?,NULL,unixepoch()*1000,p.spend_id FROM pro_requests p
        WHERE p.user_id=? AND p.request_key=? AND p.owner_id=? AND p.state='dispatching'
        AND NOT EXISTS (SELECT 1 FROM credit_events WHERE refund_of=p.spend_id)`)
        .bind(`run_${nanoid(16)}`,cost,userId,row.request_key,row.owner_id),
      env.DB.prepare(`UPDATE pro_requests SET state='completed',updated_at=unixepoch()
        WHERE user_id=? AND request_key=? AND owner_id=? AND state='dispatching'
        AND NOT EXISTS (SELECT 1 FROM credit_events WHERE refund_of=spend_id)
        AND EXISTS (SELECT 1 FROM run_history WHERE spend_event_id=spend_id)`)
        .bind(userId,row.request_key,row.owner_id),
    ] : [
      env.DB.prepare(`UPDATE pro_requests SET state='failed_refunded',updated_at=unixepoch()
        WHERE user_id=? AND request_key=? AND owner_id=? AND state='dispatching'`).bind(userId,row.request_key,row.owner_id),
      env.DB.prepare(`INSERT OR IGNORE INTO credit_events(id,user_id,kind,amount,tool_id,refund_of,note,created_at)
        SELECT ?,user_id,'refund',?,tool_id,spend_id,'Refund for failed managed request',unixepoch()*1000
        FROM pro_requests WHERE user_id=? AND request_key=? AND owner_id=? AND state='failed_refunded'`)
        .bind(`evt_${nanoid(16)}`,cost,userId,row.request_key,row.owner_id),
    ];
    await env.DB.batch(statements);
    const stored = await getRow(env,userId,row.request_key);
    return stored?.owner_id === row.owner_id && stored.state === target;
  } catch {
    try {
      const stored = await getRow(env, userId, row.request_key);
      if (stored?.owner_id !== row.owner_id) return false;
      if (stored.state === target) return true;
      if (stored.state !== 'dispatching') return false;
    } catch {
      // The CAS predicates make retrying a write after an ambiguous commit safe.
    }
    return attempt < 1 ? settleManaged(env, userId, row, success, cost, attempt + 1) : false;
  }
}
