import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet as listShares, onRequestPost as createShare } from './shares';
import { onRequestPost as deleteShare } from './shares/delete';
import { onRequestGet as viewShare } from '../s/[id]';
import type { Env } from '../_lib/env';
import type { PagesFunctionContext } from '../_lib/types';
import { createSqliteTestDb } from '../_lib/test/sqlite';
import {
  resetShareViewLimiter,
  SHARE_CLEANUP_BATCH,
  SHARE_MAX_ACTIVE,
  SHARE_MAX_CREATES_PER_DAY,
  SHARE_TTL_MS,
  SHARE_VIEWS_PER_MINUTE,
} from '../_lib/shares';
import type * as Auth from '../_lib/auth';

const auth = vi.hoisted((): { userId: string | null } => ({ userId: 'owner' }));

vi.mock('../_lib/auth', async (original) => ({
  ...(await original<typeof Auth>()),
  resolveUser: vi.fn(() =>
    Promise.resolve(
      auth.userId ? { id: auth.userId, email: `${auth.userId}@example.com`, kid: 'k', authSource: 'cookie' } : null,
    ),
  ),
}));

const NOW = 1_800_000_000_000;

describe('share links for Pro results', () => {
  let sqlite: Awaited<ReturnType<typeof createSqliteTestDb>>;
  let env: Env;

  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    resetShareViewLimiter();
    auth.userId = 'owner';
    sqlite = await createSqliteTestDb();
    env = { DB: sqlite.db, SHARE_LINKS_ENABLED: '1' } as unknown as Env;
    await sqlite.exec(
      `INSERT INTO users(id,email,created_at) VALUES('owner','owner@example.com',0),('other','other@example.com',0);
       INSERT INTO run_history(id,user_id,tool_id,tier,credits_used,ran_at)
         VALUES('r1','owner','ocr-hq','pro',1,${NOW - 60_000}),
               ('r2','owner','transcribe-pro','pro',3,${NOW - 2 * 24 * 3600_000});`,
    );
  });
  afterEach(async () => {
    await sqlite.close();
    vi.restoreAllMocks();
  });

  const ctx = (request: Request, params: Record<string, string> = {}) =>
    ({ request, env, params }) as unknown as PagesFunctionContext;
  const post = (path: string, body: unknown, headers: Record<string, string> = { 'X-Wyreup-CSRF': '1' }) =>
    new Request(`https://wyreup.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const create = (body: unknown, headers?: Record<string, string>) =>
    createShare(ctx(post('/api/shares', body, headers)));
  const view = (id: string) => viewShare(ctx(new Request(`https://wyreup.com/s/${id}`), { id }));

  it('creates a 30-day link for a recent Pro run and serves it publicly with a credit', async () => {
    const res = await create({ toolId: 'ocr-hq', text: 'INVOICE 2024\n<b>Total</b> $10' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; url: string; expiresAt: number };
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.url).toBe(`https://wyreup.com/s/${body.id}`);
    expect(body.expiresAt).toBe(NOW + SHARE_TTL_MS);

    auth.userId = null;
    const page = await view(body.id);
    expect(page.status).toBe(200);
    expect(page.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(page.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    const html = await page.text();
    expect(html).toContain('INVOICE 2024');
    expect(html).toContain('&lt;b&gt;Total&lt;/b&gt;');
    expect(html).not.toContain('<b>Total</b>');
    expect(html).toContain('Made with Wyreup');
    // Expiry is exact to the minute in UTC, not just a date.
    expect(html).toMatch(/This link expires on [A-Z][a-z]+ \d{1,2}, \d{4}(,| at) \d{1,2}:\d{2} [AP]M UTC, and Wyreup then deletes the text\./);
    expect(html).toContain('href="https://wyreup.com/tools/ocr-hq/"');
  });

  it('requires sign-in and the CSRF header', async () => {
    auth.userId = null;
    expect((await create({ toolId: 'ocr-hq', text: 'x' })).status).toBe(401);
    auth.userId = 'owner';
    expect((await create({ toolId: 'ocr-hq', text: 'x' }, {})).status).toBe(403);
  });

  it('only shares text results of a Pro tool the owner ran in the last day', async () => {
    expect((await create({ toolId: 'hash', text: 'x' })).status).toBe(400);
    expect((await create({ toolId: 'image-generate-pro', text: 'x' })).status).toBe(400);
    expect((await create({ toolId: 'transcribe-pro', text: 'x' })).status).toBe(403);
    expect((await create({ toolId: 'ocr-hq', text: '   ' })).status).toBe(400);
    expect((await create({ toolId: 'ocr-hq', text: 'x'.repeat(100_001) })).status).toBe(413);
  });

  const DAY = 24 * 3600_000;
  let runSeq = 0;
  const addRuns = (count: number, at: number, toolId = 'ocr-hq', userId = 'owner') =>
    sqlite.exec(
      `INSERT INTO run_history(id,user_id,tool_id,tier,credits_used,ran_at) VALUES ${Array.from(
        { length: count },
        () => `('x${++runSeq}','${userId}','${toolId}','pro',1,${at})`,
      ).join(',')};`,
    );
  const count = async (sql: string) => ((await sqlite.db.prepare(sql).first<{ n: number }>())?.n ?? -1);
  const remove = (id: string) => deleteShare(ctx(post('/api/shares/delete', { id })));
  const createdId = async (text: string) => {
    const res = await create({ toolId: 'ocr-hq', text });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };

  it('uses up one paid run per link, and deleting the link does not give the run back', async () => {
    const id = await createdId('first');
    const again = await create({ toolId: 'ocr-hq', text: 'second' });
    expect(again.status).toBe(403);
    expect(((await again.json()) as { error: string }).error).toMatch(/each link needs its own PRO run/i);
    expect((await remove(id)).status).toBe(200);
    expect((await create({ toolId: 'ocr-hq', text: 'after delete' })).status).toBe(403);
    await addRuns(1, NOW - 1000);
    expect((await create({ toolId: 'ocr-hq', text: 'new run' })).status).toBe(201);
  });

  it('does not count a run of a different tool or a free run', async () => {
    await sqlite.exec(
      `INSERT INTO run_history(id,user_id,tool_id,tier,credits_used,ran_at) VALUES('f1','owner','text-summarize-pro','free',0,${NOW - 1000});`,
    );
    expect((await create({ toolId: 'text-summarize-pro', text: 'x' })).status).toBe(403);
  });

  it('caps link creation per rolling day, counting deleted links', async () => {
    await addRuns(SHARE_MAX_CREATES_PER_DAY + 5, NOW - 1000);
    for (let i = 0; i < SHARE_MAX_CREATES_PER_DAY; i++) {
      expect((await remove(await createdId(`churn ${i}`))).status).toBe(200);
    }
    expect(await count('SELECT COUNT(*) AS n FROM shared_results')).toBe(0);
    const res = await create({ toolId: 'ocr-hq', text: 'over budget' });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(
      new RegExp(`${SHARE_MAX_CREATES_PER_DAY} links in the last 24 hours`),
    );
  });

  it('holds the run and daily limits under concurrent requests', async () => {
    const burst = (n: number, prefix: string) =>
      Promise.all(Array.from({ length: n }, async (_, i) => create({ toolId: 'ocr-hq', text: `${prefix}${i}` })));
    const one = await burst(6, 'c');
    expect(one.filter((r) => r.status === 201)).toHaveLength(1);
    await addRuns(SHARE_MAX_CREATES_PER_DAY + 5, NOW - 1000);
    const many = await burst(SHARE_MAX_CREATES_PER_DAY + 5, 'm');
    expect(many.filter((r) => r.status === 201)).toHaveLength(SHARE_MAX_CREATES_PER_DAY - 1);
    expect(await count('SELECT COUNT(*) AS n FROM shared_results')).toBe(SHARE_MAX_CREATES_PER_DAY);
  });

  it('caps active links per account across days', async () => {
    let at = NOW;
    let made = 0;
    while (made < SHARE_MAX_ACTIVE) {
      vi.spyOn(Date, 'now').mockReturnValue(at);
      await addRuns(SHARE_MAX_CREATES_PER_DAY, at - 1000);
      for (let i = 0; i < SHARE_MAX_CREATES_PER_DAY && made < SHARE_MAX_ACTIVE; i++, made++) {
        await createdId(`n${made}`);
      }
      at += DAY + 1;
    }
    vi.spyOn(Date, 'now').mockReturnValue(at);
    await addRuns(1, at - 1000);
    const res = await create({ toolId: 'ocr-hq', text: 'one more' });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(new RegExp(`${SHARE_MAX_ACTIVE} active links`));
  });

  it('lists only the caller’s active links and lets only the owner delete', async () => {
    const { id } = (await (await create({ toolId: 'ocr-hq', text: 'hello world' })).json()) as { id: string };

    const list = (await (await listShares(ctx(new Request('https://wyreup.com/api/shares')))).json()) as {
      shares: { id: string; toolId: string; preview: string }[];
    };
    expect(list.shares).toEqual([
      expect.objectContaining({ id, toolId: 'ocr-hq', preview: 'hello world' }),
    ]);

    auth.userId = 'other';
    expect((await deleteShare(ctx(post('/api/shares/delete', { id })))).status).toBe(404);
    expect((await view(id)).status).toBe(200);

    auth.userId = 'owner';
    expect((await deleteShare(ctx(post('/api/shares/delete', { id })))).status).toBe(200);
    expect((await view(id)).status).toBe(404);
  });

  it('is off unless SHARE_LINKS_ENABLED is "1", including for existing links', async () => {
    const { id } = (await (await create({ toolId: 'ocr-hq', text: 'kept' })).json()) as { id: string };
    env.SHARE_LINKS_ENABLED = undefined;
    expect((await create({ toolId: 'ocr-hq', text: 'x' })).status).toBe(404);
    expect((await listShares(ctx(new Request('https://wyreup.com/api/shares')))).status).toBe(404);
    expect((await deleteShare(ctx(post('/api/shares/delete', { id })))).status).toBe(404);
    expect((await view(id)).status).toBe(404);
    expect(
      await sqlite.db.prepare('SELECT COUNT(*) AS n FROM shared_results').first(),
    ).toEqual({ n: 1 });
  });

  it('returns 404 for expired or unknown links and deletes an expired link it is asked for', async () => {
    const id = await createdId('soon gone');
    vi.spyOn(Date, 'now').mockReturnValue(NOW + SHARE_TTL_MS + 1);
    expect((await view(id)).status).toBe(404);
    expect(await count('SELECT COUNT(*) AS n FROM shared_results')).toBe(0);
    expect((await view('not-a-real-id')).status).toBe(404);
  });

  it("deletes the caller's expired links when they list their links", async () => {
    await createdId('expires');
    vi.spyOn(Date, 'now').mockReturnValue(NOW + SHARE_TTL_MS + 1);
    const res = await listShares(ctx(new Request('https://wyreup.com/api/shares')));
    expect(((await res.json()) as { shares: unknown[] }).shares).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM shared_results WHERE user_id = 'owner'")).toBe(0);
  });

  it('sweeps a bounded batch of anyone expired links on each create, list and delete', async () => {
    const rows = Array.from(
      { length: SHARE_CLEANUP_BATCH * 2 + 5 },
      (_, i) => `('${`e${String(i).padStart(21, '0')}`}','other','ocr-hq','old',${NOW - SHARE_TTL_MS - 10},${NOW - 1})`,
    );
    await sqlite.exec(
      `INSERT INTO shared_results(id,user_id,tool_id,body,created_at,expires_at) VALUES ${rows.join(',')};`,
    );
    const expired = () => count(`SELECT COUNT(*) AS n FROM shared_results WHERE expires_at <= ${NOW}`);
    const id = await createdId('live');
    expect(await expired()).toBe(SHARE_CLEANUP_BATCH + 5);
    await listShares(ctx(new Request('https://wyreup.com/api/shares')));
    expect(await expired()).toBe(5);
    expect((await remove(id)).status).toBe(200);
    expect(await expired()).toBe(0);
  });

  it('drops creation records once they can no longer affect a limit', async () => {
    await createdId('old');
    expect(await count('SELECT COUNT(*) AS n FROM share_creations')).toBe(1);
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 2 * DAY + 1);
    await addRuns(1, NOW + 2 * DAY);
    await createdId('new');
    expect(await count('SELECT COUNT(*) AS n FROM share_creations')).toBe(1);
  });

  it('removes links and creation records with the account', async () => {
    await createdId('mine');
    await sqlite.exec(`DELETE FROM run_history WHERE user_id='owner'; DELETE FROM users WHERE id='owner';`);
    expect(await count('SELECT COUNT(*) AS n FROM shared_results')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM share_creations')).toBe(0);
  });

  it('tells browsers not to store the public page, so deletion and expiry apply on the next visit', async () => {
    const id = await createdId('fresh');
    const ok = await view(id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Cache-Control')).toBe('no-store');
    expect((await view('x'.repeat(22))).headers.get('Cache-Control')).toBe('no-store');
  });

  it('limits public views per network before touching the database', async () => {
    const id = await createdId('popular');
    const viewFrom = (ip: string) =>
      viewShare(ctx(new Request(`https://wyreup.com/s/${id}`, { headers: { 'CF-Connecting-IP': ip } }), { id }));
    for (let i = 0; i < SHARE_VIEWS_PER_MINUTE; i++) expect((await viewFrom('198.51.100.7')).status).toBe(200);
    const prepare = vi.spyOn(sqlite.db, 'prepare');
    const limited = await viewFrom('198.51.100.7');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
    expect(prepare).not.toHaveBeenCalled();
    expect((await viewFrom('198.51.100.8')).status).toBe(200);
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 60_000);
    expect((await viewFrom('198.51.100.7')).status).toBe(200);
  });
});
