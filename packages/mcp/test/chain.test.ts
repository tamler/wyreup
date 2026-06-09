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

// Intermediate-size cap for chains [spec §#5]: an intermediate Blob between
// chain steps that exceeds the per-step ceiling aborts the chain before the
// next step (and before the final write). We inject a tiny generator tool into
// the server's registry and shrink the cap via WYREUP_MAX_INPUT_BYTES so the
// test doesn't have to allocate hundreds of MB.
describe('chain intermediate size cap [spec §#5]', () => {
  const ORIG_KEY = process.env['WYREUP_API_KEY'];
  const ORIG_ALLOW = process.env['WYREUP_ALLOW_PATHS'];
  const ORIG_MAX = process.env['WYREUP_MAX_INPUT_BYTES'];

  beforeAll(() => {
    delete process.env['WYREUP_API_KEY'];
    process.env['WYREUP_ALLOW_PATHS'] = '*';
    // 1 KB per-step cap; the fake tool emits 4 KB, which is over the limit.
    process.env['WYREUP_MAX_INPUT_BYTES'] = '1024';
  });

  afterAll(() => {
    if (ORIG_KEY === undefined) delete process.env['WYREUP_API_KEY'];
    else process.env['WYREUP_API_KEY'] = ORIG_KEY;
    if (ORIG_ALLOW === undefined) delete process.env['WYREUP_ALLOW_PATHS'];
    else process.env['WYREUP_ALLOW_PATHS'] = ORIG_ALLOW;
    if (ORIG_MAX === undefined) delete process.env['WYREUP_MAX_INPUT_BYTES'];
    else process.env['WYREUP_MAX_INPUT_BYTES'] = ORIG_MAX;
  });

  it('aborts the chain when a step output exceeds the per-step cap', async () => {
    const srv = await createWyreupMcpServer();
    // The chain handler closes over the registry created at server
    // construction; inject a no-input generator that emits an over-cap blob.
    const registry = (srv as unknown as { __wyreupRegistry: { toolsById: Map<string, unknown> } })
      .__wyreupRegistry;
    const oversizedTool = {
      id: 'test-oversized-gen',
      slug: 'test-oversized-gen',
      name: 'Test Oversized Generator',
      description: 'Test-only tool that emits a blob larger than the cap.',
      category: 'utility',
      keywords: [],
      input: { accept: [], min: 0, max: 0 },
      output: { mime: 'application/octet-stream' },
      interactive: false,
      batchable: false,
      cost: 'free',
      memoryEstimate: 'low',
      // eslint-disable-next-line @typescript-eslint/require-await
      run: async () => new Blob([new Uint8Array(4 * 1024)], { type: 'application/octet-stream' }),
    };
    // Registry's toolsById is a real Map under the readonly type.
    registry.toolsById.set(oversizedTool.id, oversizedTool);

    const r = await callTool(srv, 'wyreup_chain', { steps: 'test-oversized-gen' });
    expect(r.isError).toBeTruthy();
    expect(r.content[0]!.text).toContain('per-step');
    expect(r.content[0]!.text).toContain('intermediate cap');
  });
});
