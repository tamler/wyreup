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

describe('document to Markdown availability gate', () => {
  let sqlite: Awaited<ReturnType<typeof createSqliteTestDb>>;
  let env: Env;
  const toMarkdown = vi.fn();

  beforeEach(async () => {
    sqlite = await createSqliteTestDb();
    env = {
      DB: sqlite.db,
      AI: { run: vi.fn(), toMarkdown },
    } as unknown as Env;
    await sqlite.exec(
      "INSERT INTO users(id,email,created_at) VALUES('user','user@example.com',0); INSERT INTO credit_events(id,user_id,kind,amount,created_at) VALUES('grant','user','grant',100,0);",
    );
  });

  afterEach(async () => {
    await sqlite.close();
    vi.restoreAllMocks();
    toMarkdown.mockReset();
  });

  it('fails closed without a provider call or credit reservation when its cost gate is not enabled', async () => {
    const run = vi.spyOn(env.AI, 'run');
    const response = await onRequestPost({
      request: new Request('https://wyreup.com/api/tools/pro/run', {
        method: 'POST',
        body: JSON.stringify({
          toolId: 'document-to-markdown-pro',
          requestKey: 'document-markdown-gate-test-1234567890',
          input: { fileName: 'sample.html', fileBase64: btoa('<h1>Heading</h1>') },
        }),
      }),
      env,
    } as PagesFunctionContext);

    expect(response.status).toBe(503);
    expect(toMarkdown).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(
      await sqlite.db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE kind != 'grant'").first(),
    ).toEqual({ n: 0 });
  });

  it('denies malformed input before document parsing, charging, or provider dispatch', async () => {
    const response = await onRequestPost({
      request: new Request('https://wyreup.com/api/tools/pro/run', {
        method: 'POST',
        body: JSON.stringify({ toolId: 'document-to-markdown-pro', input: { fileBase64: '!!!' } }),
      }),
      env,
    } as PagesFunctionContext);
    expect(response.status).toBe(503);
    expect(toMarkdown).not.toHaveBeenCalled();
    expect(await sqlite.db.prepare("SELECT COUNT(*) AS n FROM credit_events WHERE kind != 'grant'").first()).toEqual({ n: 0 });
  });
});
