import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWyreupMcpServer } from '../src/server.js';

async function callTool(srv: unknown, name: string, args: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const handlers = (srv as any)._requestHandlers as Map<string, (req: unknown, extra: unknown) => unknown>;
  return handlers.get('tools/call')!({ method: 'tools/call', params: { name, arguments: args } }, {}) as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

describe('input size cap [spec §#5]', () => {
  const ORIG_KEY = process.env['WYREUP_API_KEY'];
  const ORIG_ALLOW = process.env['WYREUP_ALLOW_PATHS'];

  beforeAll(() => {
    process.env['WYREUP_API_KEY'] = 'wk_test_size';
    process.env['WYREUP_ALLOW_PATHS'] = tmpdir();
  });
  afterAll(() => {
    if (ORIG_KEY === undefined) delete process.env['WYREUP_API_KEY'];
    else process.env['WYREUP_API_KEY'] = ORIG_KEY;
    if (ORIG_ALLOW === undefined) delete process.env['WYREUP_ALLOW_PATHS'];
    else process.env['WYREUP_ALLOW_PATHS'] = ORIG_ALLOW;
  });

  it('rejects an input over WYREUP_MAX_INPUT_BYTES', async () => {
    const ORIG = process.env['WYREUP_MAX_INPUT_BYTES'];
    process.env['WYREUP_MAX_INPUT_BYTES'] = String(1024); // 1 KB cap for the test
    try {
      const srv = await createWyreupMcpServer();
      const tmp = await mkdtemp(join(tmpdir(), 'wymcp-sz-'));
      const big = join(tmp, 'big.jpg');
      // Sparse 2 KB file (size > cap, no real disk usage)
      const fh = await open(big, 'w');
      await fh.truncate(2048);
      await fh.close();
      const r = await callTool(srv, 'compress', { input_paths: [big], output_path: join(tmp, 'out.jpg') });
      expect(r.isError).toBe(true);
      expect(r.content[0]?.text).toMatch(/exceeds limit/);
    } finally {
      if (ORIG === undefined) delete process.env['WYREUP_MAX_INPUT_BYTES'];
      else process.env['WYREUP_MAX_INPUT_BYTES'] = ORIG;
    }
  });

  it('accepts inputs under the cap', async () => {
    const srv = await createWyreupMcpServer();
    const tmp = await mkdtemp(join(tmpdir(), 'wymcp-sz-ok-'));
    const ok = join(tmp, 'small.jpg');
    // Minimal valid JPEG bytes
    const { writeFile } = await import('node:fs/promises');
    await writeFile(ok, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const r = await callTool(srv, 'compress', { input_paths: [ok], output_path: join(tmp, 'out.jpg') });
    // The tool may fail for other reasons (4-byte stub isn't a real image),
    // but the failure must NOT be "exceeds limit".
    if (r.isError) {
      expect(r.content[0]?.text).not.toMatch(/exceeds limit/);
    }
  });
});
