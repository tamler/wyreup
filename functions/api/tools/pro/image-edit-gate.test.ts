import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './run';
import type { Env } from '../../../_lib/env';
import type { PagesFunctionContext } from '../../../_lib/types';
import { createSqliteTestDb } from '../../../_lib/test/sqlite';
import type * as Auth from '../../../_lib/auth';

vi.mock('../../../_lib/auth', async (original) => ({
  ...(await original<typeof Auth>()),
  resolveUser: vi.fn(() => Promise.resolve({ id: 'user' })),
  requireCsrfHeader: vi.fn(() => null),
}));

describe('image editing availability gate', () => {
  let sqlite: Awaited<ReturnType<typeof createSqliteTestDb>>;
  let env: Env;
  let modelRun: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    sqlite = await createSqliteTestDb();
    modelRun = vi.fn();
    env = { DB: sqlite.db, AI: { run: modelRun } } as unknown as Env;
    await sqlite.exec(
      "INSERT INTO users(id,email,created_at) VALUES('user','user@example.com',0); INSERT INTO credit_events(id,user_id,kind,amount,created_at) VALUES('grant','user','grant',100,0);",
    );
  });
  afterEach(async () => {
    await sqlite.close();
    vi.restoreAllMocks();
  });

  it.each([
    { imageBase64: 'iVBORw0KGgo=', prompt: 'Remove the chair' },
    { imageBase64: '!!!', prompt: '' },
    {},
  ])('returns unavailable with no model work or spend for input %#', async input => {
    const response = await onRequestPost({
      request: new Request('https://wyreup.com/api/tools/pro/run', {
        method: 'POST',
        body: JSON.stringify({ toolId: 'image-edit-pro', input }),
      }),
      env,
    } as PagesFunctionContext);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'feature_unavailable' });
    expect(modelRun).not.toHaveBeenCalled();
    expect(
      await sqlite.db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE kind != 'grant'").first(),
    ).toEqual({ n: 0 });
  });
});
