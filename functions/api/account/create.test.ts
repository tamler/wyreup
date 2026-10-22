import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost as create } from './create';
import { onRequestPost as verify } from './verify';
import { onRequestPost as createKey } from './keys';
import { requireAdmin, requireCsrfHeader, resolveUser } from '../../_lib/auth';
import { generateApiKey, sha256hex, signSessionCookie } from '../../_lib/crypto';
import { createSqliteTestDb } from '../../_lib/test/sqlite';
import type { Env } from '../../_lib/env';
import type { PagesFunctionContext } from '../../_lib/types';

let database: Awaited<ReturnType<typeof createSqliteTestDb>>;
let env: Env;
let sentKeys: string[];
let delivery: 'success' | 'failure' | 'throw';

function context(request: Request): PagesFunctionContext {
  return { request, env, params: {}, data: {}, next: () => Promise.resolve(new Response()), waitUntil: () => {} };
}
async function signup(email = 'owner@example.com', ip = '192.0.2.1') {
  return await create(context(new Request('https://wyreup.com/api/account/create', {
    method: 'POST', headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, surface: 'browser' }),
  })));
}
function bearer(key: string) {
  return new Request('https://wyreup.com/api/account/verify', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` },
  });
}
async function count(table: string) {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}

beforeEach(async () => {
  database = await createSqliteTestDb();
  env = { DB: database.db, SESSION_SECRET: 'test-secret', ADMIN_EMAILS: 'owner@example.com',
    ZEPTOMAIL_TOKEN: 'test', ZEPTOMAIL_SENDER: 'sender@example.com' } as Env;
  sentKeys = [];
  delivery = 'success';
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    if (typeof init.body !== 'string') throw new Error('Expected JSON email body');
    const mail = JSON.parse(init.body) as { textbody: string };
    sentKeys.push(mail.textbody.match(/wk_live_[a-f0-9]{64}/)![0]);
    if (delivery === 'throw') return Promise.reject(new Error('transport failure'));
    return Promise.resolve(new Response('{}', { status: delivery === 'failure' ? 503 : 200 }));
  }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await database.close();
});

describe('email ownership and recovery', () => {
  it('rejects browser-simple cross-site submissions before recording attempts or sending mail', async () => {
    const response = await create(context(new Request('https://wyreup.com/api/account/create', {
      method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://untrusted.example' },
      body: JSON.stringify({ email: 'owner@example.com' }),
    })));
    expect(response.status).toBe(415);
    expect(await count('create_attempts')).toBe(0);
    expect(sentKeys).toEqual([]);
  });
  it('keeps a provisional key unusable until delivery completes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (typeof init.body !== 'string') throw new Error('Expected JSON email body');
      const mail = JSON.parse(init.body) as { textbody: string };
      const key = mail.textbody.match(/wk_live_[a-f0-9]{64}/)![0];
      expect(await resolveUser(bearer(key), env)).toBeNull();
      sentKeys.push(key);
      return new Response('{}');
    }));
    expect((await signup()).status).toBe(200);
    expect(await resolveUser(bearer(sentKeys[0]), env)).not.toBeNull();
  });

  it('never exposes browser credentials; only the mailbox key can authenticate or become admin', async () => {
    const response = await signup();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'check_email' });
    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(await resolveUser(new Request('https://wyreup.com'), env)).toBeNull();
    expect(await requireAdmin(bearer(sentKeys[0]), env)).toMatchObject({ email: 'owner@example.com' });
    const activated = await verify(context(bearer(sentKeys[0])));
    expect(activated.status).toBe(200);
    expect(activated.headers.get('Set-Cookie')).toContain('HttpOnly');
  });

  it('denies legacy keys and their sessions, preserves account and balances through canonical recovery', async () => {
    const oldKey = generateApiKey();
    await env.DB.prepare('INSERT INTO users(id,email,created_at) VALUES(?,?,0)')
      .bind('original', 'owner@example.com').run();
    await env.DB.prepare('INSERT INTO api_keys(id,user_id,key_hash,name,created_at) VALUES(?,?,?,?,0)')
      .bind('legacy', 'original', await sha256hex(oldKey), 'Legacy').run();
    await env.DB.prepare("INSERT INTO credit_events(id,user_id,kind,amount,created_at) VALUES('credit','original','grant',100,0)").run();
    expect(await resolveUser(bearer(oldKey), env)).toBeNull();
    const cookie = await signSessionCookie({ uid: 'original', kid: 'legacy', exp: Date.now() + 10000 }, env.SESSION_SECRET);
    expect(await resolveUser(new Request('https://wyreup.com', { headers: { Cookie: `__Host-wyreup_session=${cookie}` } }), env)).toBeNull();
    expect((await signup(' OWNER@EXAMPLE.COM ')).status).toBe(200);
    const response = await verify(context(bearer(sentKeys[0])));
    expect(await response.json()).toMatchObject({ email: 'owner@example.com', balance: 100 });
    expect(await count('users')).toBe(1);
    expect(await resolveUser(bearer(oldKey), env)).toBeNull();
    expect(await env.DB.prepare("SELECT bucket_val FROM create_attempts WHERE bucket_kind='email'").first()).toEqual({ bucket_val: 'owner@example.com' });
  });

  it.each(['failure', 'throw'] as const)('cleans only failed provisional key and permits retry after %s', async (mode) => {
    await signup();
    const valid = sentKeys[0];
    delivery = mode;
    const failed = await signup();
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'Could not deliver email — please retry' });
    expect(await count('api_keys')).toBe(1);
    expect(await resolveUser(bearer(sentKeys[1]), env)).toBeNull();
    expect(await resolveUser(bearer(valid), env)).not.toBeNull();
    delivery = 'success';
    expect((await signup()).status).toBe(200);
    expect(await count('users')).toBe(1);
    expect(await count('api_keys')).toBe(2);
  });

  it('uses identical failed-mail responses for new and existing addresses', async () => {
    delivery = 'failure';
    const first = await signup();
    const second = await signup();
    expect(first.status).toBe(502);
    expect(second.status).toBe(first.status);
    expect(await second.json()).toEqual(await first.json());
    expect(await count('api_keys')).toBe(0);
  });

  it('atomically admits five concurrent requests to the same canonical mailbox', async () => {
    const responses = await Promise.all(Array.from({ length: 15 }, (_, i) => signup(i % 2 ? ' OWNER@EXAMPLE.COM ' : 'owner@example.com')));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(5);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(10);
    expect(await count('create_attempts')).toBe(10);
    expect(await count('users')).toBe(1);
    expect(await count('api_keys')).toBe(5);
  });

  it('atomically admits ten concurrent distinct mailboxes per IP', async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => signup(`owner${i}@example.com`)));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(10);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(10);
    expect(await count('create_attempts')).toBe(20);
    expect(sentKeys).toHaveLength(10);
  });

  it.each(['null', '[]', '{', JSON.stringify({ email: 'x'.repeat(5000) })])('rejects malformed or oversized body before effects: %s', async (body) => {
    const response = await create(context(new Request('https://wyreup.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })));
    expect([400, 413]).toContain(response.status);
    expect(await count('create_attempts')).toBe(0);
    expect(await count('users')).toBe(0);
  });

  it('handles malformed cookies and bases CSRF on actual authentication source', async () => {
    await signup();
    const key = sentKeys[0];
    const malformed = bearer(key);
    malformed.headers.set('Cookie', '__Host-wyreup_session=%E0%A4%A');
    const user = await resolveUser(malformed, env);
    expect(user?.authSource).toBe('bearer');
    expect(requireCsrfHeader(malformed, user!)).toBeNull();
    const activated = await verify(context(bearer(key)));
    const cookieRequest = bearer('invalid');
    cookieRequest.headers.set('Cookie', activated.headers.get('Set-Cookie')!.split(';')[0]);
    const cookieUser = await resolveUser(cookieRequest, env);
    expect(cookieUser?.authSource).toBe('cookie');
    expect(requireCsrfHeader(cookieRequest, cookieUser!)?.status).toBe(403);
    await env.DB.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').bind(Date.now(), cookieUser!.kid).run();
    expect(await resolveUser(cookieRequest, env)).toBeNull();
    expect(await resolveUser(bearer(key), env)).toBeNull();
  });

  it('propagates trusted provenance and atomically caps generated keys while allowing recovery', async () => {
    await signup();
    const key = sentKeys[0];
    const responses = await Promise.all(Array.from({ length: 15 }, async (_, i) => await createKey(context(new Request('https://wyreup.com/api/account/keys', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({ name: `device-${i}` }),
    })))));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(9);
    expect(await count('api_keys')).toBe(10);
    const generated = await responses.find((r) => r.status === 200)!.json() as { rawKey: string };
    expect(await resolveUser(bearer(generated.rawKey), env)).not.toBeNull();
    expect((await signup()).status).toBe(200);
    expect(await resolveUser(bearer(key), env)).not.toBeNull();
  });
});
