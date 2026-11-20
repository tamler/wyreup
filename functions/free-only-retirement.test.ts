import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { onRequest as apiCatchAll } from './api/[[path]]';
import { onRequest as middleware } from './_middleware';
import type { PagesFunctionContext } from './_lib/types';
import { createSqliteTestDb } from './_lib/test/sqlite';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);

function context(
  path: string,
  method: string,
  env: unknown = new Proxy({}, { get: (_target, property) => { throw new Error(`unexpected env access: ${String(property)}`); } }),
  next = vi.fn(() => Promise.resolve(new Response('continued'))),
  body?: string,
): PagesFunctionContext {
  return {
    request: new Request(`https://wyreup.com${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body }),
    }),
    env,
    params: {},
    data: {},
    next,
    waitUntil() { throw new Error('unexpected waitUntil()'); },
  } as unknown as PagesFunctionContext;
}

function rawPathContext(path: string, method: string, next: PagesFunctionContext['next']): PagesFunctionContext {
  return {
    request: { url: `https://wyreup.com${path}`, method },
    env: new Proxy({}, { get: (_target, property) => { throw new Error(`unexpected env access: ${String(property)}`); } }),
    params: {},
    data: {},
    next,
    waitUntil() { throw new Error('unexpected waitUntil()'); },
  } as unknown as PagesFunctionContext;
}

async function routeFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...await routeFiles(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
  }
  return found.sort();
}

describe('free-only API retirement', () => {
  it('denies every API path except exact public endpoints before next or env access', async () => {
    const apiPaths = [
      '/api', '/api/', '/api/account/create', '/api/admin/limits', '/api/credits/checkout',
      '/api/tools/pro/run', '/api/webhooks/lemonsqueezy', '/api/future/route',
      '/api/metrics/hit',
      '/api//domain-age', '//api/domain-age', '/%61pi/domain-age', '/api%2Fdomain-age',
      '/api/domain-age//', '/api/domain-age%2fextra', '/api/%ZZ', '/API/domain-age',
      '/api/domain-age/../domain-age', '/api/domain-age/%2e%2e/domain-age',
      '/api/metrics/hit?extra=1', '/api/metrics/hit?',
    ];
    for (const path of apiPaths) {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
        const next = vi.fn(() => Promise.resolve(new Response('must not continue')));
        const response = await middleware(rawPathContext(path, method, next));
        expect(response.status, `${method} ${path}`).toBe(410);
        expect(next, `${method} ${path}`).not.toHaveBeenCalled();
      }
    }
  });

  it.each([
    ['/api/domain-age', 'POST'], ['/api/domain-age/', 'POST'],
  ])('continues only the permitted public endpoint %s %s', async (path, method) => {
    const next = vi.fn(() => Promise.resolve(new Response('allowed')));
    const response = await middleware(context(path, method, undefined, next));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('allowed');
    expect(next).toHaveBeenCalledOnce();
  });

  it('passes non-API pages through without reading environment', async () => {
    const next = vi.fn(() => Promise.resolve(new Response('page')));
    expect((await middleware(context('/about', 'GET', undefined, next))).status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
  });

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])
    ('the physical API fallback denies %s without environment or continuation', async method => {
      const next = vi.fn(() => Promise.resolve(new Response('must not continue')));
      const response = await apiCatchAll(context('/api/not-inventory', method, undefined, next));
      expect(response.status).toBe(410);
      expect(next).not.toHaveBeenCalled();
    });

  it('keeps only the two intended public API entrypoints and the deny-all fallback', async () => {
    const routes = await routeFiles(resolve(REPO_ROOT, 'functions/api'));
    expect(routes.map(path => path.replace(`${resolve(REPO_ROOT, 'functions')}/`, ''))).toEqual([
      'api/[[path]].ts', 'api/domain-age.ts',
    ]);
    for (const path of routes) {
      const source = await readFile(path, 'utf8');
      expect(source).not.toMatch(/(?:from\s+|import\s*\()\s*['"][^'"]*(?:providers|auth|email|pricing|billing)/i);
    }
    const [wrangler, envTypes, devVars] = await Promise.all([
      readFile(resolve(REPO_ROOT, 'wrangler.toml'), 'utf8'),
      readFile(resolve(REPO_ROOT, 'functions/_lib/env.ts'), 'utf8'),
      readFile(resolve(REPO_ROOT, '.dev.vars.example'), 'utf8'),
    ]);
    expect(wrangler).not.toMatch(/^\[ai\]/m);
    expect(envTypes).not.toMatch(/\b(?:AI|LS_[A-Z_]+|ZEPTOMAIL_[A-Z_]+)\s*:/);
    expect(devVars).not.toMatch(/^(?:LS_|ZEPTOMAIL_|IMAGE_MODEL_TOKEN=)/m);
  });

  it('keeps exactly the free-only Functions runtime source inventory', async () => {
    const root = resolve(REPO_ROOT, 'functions');
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    expect(entries.every(entry => entry.isDirectory() || entry.isFile())).toBe(true);
    const testSupport = new Set([
      '_lib/test/domain-rate-wrangler.jsonc',
      '_lib/test/sqlite.ts',
      'tsconfig.json',
    ]);
    const runtime = entries
      .filter(entry => entry.isFile())
      .map(entry => relative(root, resolve(entry.parentPath, entry.name)).split(sep).join('/'))
      .filter(path => !testSupport.has(path) && !path.endsWith('.test.ts'))
      .sort();
    expect(runtime).toEqual([
      '_lib/crypto.ts',
      '_lib/env.ts',
      '_lib/public-rate-limit.ts',
      '_lib/rdap.ts',
      '_lib/retired.ts',
      '_lib/types.ts',
      '_middleware.ts',
      'api/[[path]].ts',
      'api/domain-age.ts',
    ]);
    for (const path of runtime) {
      const source = await readFile(resolve(root, path), 'utf8');
      expect(source, path).not.toMatch(/\b(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)['"](?:[^'"]*\/)?test(?:\/|['"])/);
    }
  });

  it('sets the retirement switch while preserving existing users and credit history', async () => {
    const sqlite = await createSqliteTestDb(async (name, db) => {
      if (name === '0009_free_only_retirement.sql') {
        await db.prepare("INSERT INTO users(id,email,created_at) VALUES('kept','kept@example.invalid',12)").run();
        await db.prepare("INSERT INTO credit_events(id,user_id,kind,amount,created_at) VALUES('kept-credit','kept','grant',20,13)").run();
        await db.prepare("UPDATE system_settings SET value='0' WHERE key='system_disabled'").run();
      }
    });
    try {
      expect(await sqlite.db.prepare("SELECT id,email,created_at FROM users WHERE id='kept'").first()).toEqual({
        id: 'kept', email: 'kept@example.invalid', created_at: 12,
      });
      expect(await sqlite.db.prepare("SELECT id,user_id,kind,amount,created_at FROM credit_events WHERE id='kept-credit'").first()).toEqual({
        id: 'kept-credit', user_id: 'kept', kind: 'grant', amount: 20, created_at: 13,
      });
      expect(await sqlite.db.prepare("SELECT value FROM system_settings WHERE key='system_disabled'").first()).toEqual({ value: '1' });
    } finally {
      await sqlite.close();
    }
  });
});
