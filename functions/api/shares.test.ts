import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet as listShares, onRequestPost as createShare } from './shares';
import { onRequestPost as deleteShare } from './shares/delete';
import { onRequestGet as viewShare } from '../s/[id]';
import type { Env } from '../_lib/env';
import type { PagesFunctionContext } from '../_lib/types';
import { createSqliteTestDb } from '../_lib/test/sqlite';
import { SHARE_MAX_ACTIVE, SHARE_TTL_MS } from '../_lib/shares';
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

  it('caps active links per account', async () => {
    for (let i = 0; i < SHARE_MAX_ACTIVE; i++) {
      expect((await create({ toolId: 'ocr-hq', text: `n${i}` })).status).toBe(201);
    }
    expect((await create({ toolId: 'ocr-hq', text: 'one more' })).status).toBe(429);
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

  it('returns 404 for expired or unknown links', async () => {
    const { id } = (await (await create({ toolId: 'ocr-hq', text: 'soon gone' })).json()) as { id: string };
    vi.spyOn(Date, 'now').mockReturnValue(NOW + SHARE_TTL_MS + 1);
    expect((await view(id)).status).toBe(404);
    expect((await view('not-a-real-id')).status).toBe(404);
  });
});
