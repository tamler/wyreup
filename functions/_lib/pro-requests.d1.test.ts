import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import type { D1Database, Env } from './env';
import { admitManaged } from './pro-requests';

describe('managed requests on local workerd D1', () => {
  let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
  let db: D1Database;
  beforeAll(async () => {
    platform = await getPlatformProxy<{ DB: D1Database }>({ configPath: fileURLToPath(new URL('./test/domain-rate-wrangler.jsonc', import.meta.url)), persist: false });
    db = platform.env.DB;
    await db.batch([
      db.prepare('CREATE TABLE users (id TEXT PRIMARY KEY)'),
      db.prepare('CREATE TABLE credit_events (id TEXT PRIMARY KEY,user_id TEXT,kind TEXT,amount INTEGER,refund_of TEXT,tool_id TEXT,note TEXT,created_at INTEGER)'),
      db.prepare('CREATE TABLE system_settings (key TEXT PRIMARY KEY,value TEXT)'),
      db.prepare('CREATE TABLE run_history (id TEXT PRIMARY KEY,spend_event_id TEXT)'),
      db.prepare("INSERT INTO users(id) VALUES ('u')"),
      db.prepare("INSERT INTO credit_events(id,user_id,kind,amount) VALUES ('s','u','spend',-1)"),
      db.prepare("INSERT INTO credit_events(id,user_id,kind,amount) VALUES ('grant','u','grant',100)"),
    ]);
    const sql = await readFile(new URL('../../migrations/0009_pro_requests.sql', import.meta.url), 'utf8');
    const statements = sql.match(/CREATE TABLE[\s\S]*?;\n|CREATE TRIGGER[\s\S]*?END;/g);
    if (!statements || statements.length !== 2) throw new Error('Unexpected managed request migration shape');
    await db.batch(statements.map(statement => db.prepare(statement)));
    await db.prepare("INSERT INTO pro_requests(user_id,request_key,tool_id,input_digest,owner_id,spend_id,state,created_at,updated_at) VALUES('u','k','t','h','o','s','dispatching',0,0)").run();
  }, 30_000);
  afterAll(async () => { await platform?.dispose(); });

  it('ignores the legacy refund insertion instead of aborting its transaction', async () => {
    const result = await db.prepare("INSERT OR IGNORE INTO credit_events(id,user_id,kind,amount,refund_of) SELECT 'r','u','refund',1,'s' WHERE NOT EXISTS (SELECT 1 FROM credit_events WHERE refund_of='s')").run();
    expect(result.success).toBe(true);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE refund_of='s'").first()).toEqual({ n: 0 });
  });

  it('rolls back every statement when a later batch statement fails', async () => {
    await expect(db.batch([
      db.prepare("INSERT INTO credit_events(id,user_id,kind,amount) VALUES('new','u','spend',-1)"),
      db.prepare("INSERT INTO users(id) VALUES('u')"),
    ])).rejects.toThrow();
    expect(await db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE id='new'").first()).toEqual({ n: 0 });
  });
  it('admits one owner for concurrent identical keys', async () => {
    const env = { DB: db, SESSION_SECRET: 'synthetic-test-secret' } as Env;
    const key = 'aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82';
    const results = await Promise.all(Array.from({ length: 10 }, () => admitManaged(env, 'u', key, 'text-sentiment-pro', { text: 'good' }, 1)));
    expect(results.filter(result => 'row' in result)).toHaveLength(1);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM pro_requests WHERE request_key=?").bind(key).first()).toEqual({ n: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE kind='spend' AND id!='s'").first()).toEqual({ n: 1 });
  });
});
