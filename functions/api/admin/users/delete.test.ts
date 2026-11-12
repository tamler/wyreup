import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteTestDb } from '../../../_lib/test/sqlite';
import { onRequestPost } from './delete';
import type * as Auth from '../../../_lib/auth';
import type { PagesFunctionContext } from '../../../_lib/types';

vi.mock('../../../_lib/auth', async original => ({
  ...await original<typeof Auth>(),
  requireAdmin: vi.fn(() => Promise.resolve({ id: 'admin', email: 'admin@example.com' })),
  requireCsrfHeader: vi.fn(() => null),
}));

describe('admin account deletion', () => {
  let db: Awaited<ReturnType<typeof createSqliteTestDb>> | undefined;
  afterEach(async () => { await db?.close(); });
  it('removes managed request tombstones with the account', async () => {
    db = await createSqliteTestDb();
    await db.exec(`INSERT INTO users(id,email,created_at) VALUES ('target','target@example.com',0);
      INSERT INTO pro_requests(user_id,request_key,tool_id,input_digest,owner_id,spend_id,state,created_at,updated_at)
      VALUES('target','key','tool','digest','owner','spend','completed',0,0);`);
    const response = await onRequestPost({ request: new Request('https://example.test', { method: 'POST', body: JSON.stringify({ email: 'target@example.com' }) }), env: { DB: db.db } } as PagesFunctionContext);
    expect(response.status).toBe(200);
    expect(await db.db.prepare('SELECT COUNT(*) AS n FROM pro_requests').first()).toEqual({ n: 0 });
    expect(await db.db.prepare('SELECT COUNT(*) AS n FROM users').first()).toEqual({ n: 0 });
  });
});
