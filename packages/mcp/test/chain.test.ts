import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWyreupMcpServer } from '../src/server.js';

const FIXTURES = new URL('../../core/test/fixtures', import.meta.url).pathname;

async function callTool(srv: unknown, name: string, args: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const handlers = (srv as any)._requestHandlers as Map<string, (req: unknown, extra: unknown) => unknown>;
  return handlers.get('tools/call')!({ method: 'tools/call', params: { name, arguments: args } }, {}) as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

describe('wyreup_chain audit [spec §#6]', () => {
  const ORIG_KEY = process.env['WYREUP_API_KEY'];
  const ORIG_ALLOW = process.env['WYREUP_ALLOW_PATHS'];
  const ORIG_AUDIT = process.env['WYREUP_AUDIT_LOG'];
  let tmp: string;
  let auditPath: string;

  beforeAll(async () => {
    process.env['WYREUP_API_KEY'] = 'wk_test_chain';
    tmp = await mkdtemp(join(tmpdir(), 'wymcp-chain-'));
    process.env['WYREUP_ALLOW_PATHS'] = `${FIXTURES}:${tmp}`;
    auditPath = join(tmp, 'audit.jsonl');
    process.env['WYREUP_AUDIT_LOG'] = auditPath;
  });

  afterAll(() => {
    if (ORIG_KEY === undefined) delete process.env['WYREUP_API_KEY'];
    else process.env['WYREUP_API_KEY'] = ORIG_KEY;
    if (ORIG_ALLOW === undefined) delete process.env['WYREUP_ALLOW_PATHS'];
    else process.env['WYREUP_ALLOW_PATHS'] = ORIG_ALLOW;
    if (ORIG_AUDIT === undefined) delete process.env['WYREUP_AUDIT_LOG'];
    else process.env['WYREUP_AUDIT_LOG'] = ORIG_AUDIT;
  });

  it('emits one audit record per chain call (not per step)', async () => {
    const srv = await createWyreupMcpServer();
    const r = await callTool(srv, 'wyreup_chain', {
      steps: 'compress[quality=70]',
      input_paths: [join(FIXTURES, 'photo.jpg')],
      output_path: join(tmp, 'chained.jpg'),
    });
    expect(r.isError).toBeFalsy();
    const { readFile } = await import('node:fs/promises');
    const lines = (await readFile(auditPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!) as { tool: string };
    expect(rec.tool).toBe('wyreup_chain');
  });
});

// Intermediate-size cap for chains is deferred — see plan Task 20 carve-out.
// The initial input cap from Task 9 still applies; this todo marks the
// outstanding work so it's visible in the test runner.
describe.skip('chain intermediate size cap [spec §#5]', () => {
  it.todo('intermediate Blob between chain steps exceeds maxBytes → chain errors before final write');
});
