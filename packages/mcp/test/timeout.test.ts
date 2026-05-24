import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWyreupMcpServer } from '../src/server.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function callTool(srv: unknown, name: string, args: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const handlers = (srv as any)._requestHandlers as Map<string, (req: unknown, extra: unknown) => unknown>;
  return handlers.get('tools/call')!({ method: 'tools/call', params: { name, arguments: args } }, {}) as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

describe('timeout validation [spec §#3]', () => {
  const ORIG_KEY = process.env['WYREUP_API_KEY'];
  const ORIG_ALLOW = process.env['WYREUP_ALLOW_PATHS'];

  beforeAll(() => {
    process.env['WYREUP_API_KEY'] = 'wk_test_timeout';
    process.env['WYREUP_ALLOW_PATHS'] = tmpdir();
  });
  afterAll(() => {
    if (ORIG_KEY === undefined) delete process.env['WYREUP_API_KEY'];
    else process.env['WYREUP_API_KEY'] = ORIG_KEY;
    if (ORIG_ALLOW === undefined) delete process.env['WYREUP_ALLOW_PATHS'];
    else process.env['WYREUP_ALLOW_PATHS'] = ORIG_ALLOW;
  });

  async function setupInput() {
    const tmp = await mkdtemp(join(tmpdir(), 'wymcp-t-'));
    const input = join(tmp, 'a.jpg');
    // Minimal valid JPEG header so the read doesn't error before timeout check
    await writeFile(input, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return { tmp, input };
  }

  it('rejects negative timeout_ms', async () => {
    const srv = await createWyreupMcpServer();
    const { tmp, input } = await setupInput();
    const r = await callTool(srv, 'compress', { input_paths: [input], output_path: join(tmp, 'b.jpg'), timeout_ms: -1 });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toMatch(/timeout_ms/);
  });

  it('rejects NaN, Infinity, fractional', async () => {
    const srv = await createWyreupMcpServer();
    const { tmp, input } = await setupInput();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      const r = await callTool(srv, 'compress', { input_paths: [input], output_path: join(tmp, `b-${String(bad)}.jpg`), timeout_ms: bad });
      expect(r.isError, `timeout_ms=${String(bad)}`).toBe(true);
    }
  });

  it('rejects 0 without permit env', async () => {
    const ORIG = process.env['WYREUP_ALLOW_DISABLE_TIMEOUT'];
    delete process.env['WYREUP_ALLOW_DISABLE_TIMEOUT'];
    try {
      const srv = await createWyreupMcpServer();
      const { tmp, input } = await setupInput();
      const r = await callTool(srv, 'compress', { input_paths: [input], output_path: join(tmp, 'b.jpg'), timeout_ms: 0 });
      expect(r.isError).toBe(true);
      expect(r.content[0]?.text).toMatch(/WYREUP_ALLOW_DISABLE_TIMEOUT/);
    } finally {
      if (ORIG !== undefined) process.env['WYREUP_ALLOW_DISABLE_TIMEOUT'] = ORIG;
    }
  });
});

describe('worker supervisor timeout=0 [spec §#3]', () => {
  it('with WYREUP_ALLOW_DISABLE_TIMEOUT=1, timeout_ms=0 runs without scheduling a kill timer', async () => {
    const { runInWorker } = await import('../src/supervisor.js');
    const ORIG_PERMIT = process.env['WYREUP_ALLOW_DISABLE_TIMEOUT'];
    process.env['WYREUP_ALLOW_DISABLE_TIMEOUT'] = '1';
    try {
      const { mkdtemp } = await import('node:fs/promises');
      const tmp = await mkdtemp(join(tmpdir(), 'wymcp-no-timer-'));
      const FIXTURES = new URL('../../core/test/fixtures', import.meta.url).pathname;
      const r = await runInWorker({
        toolId: 'compress',
        inputPaths: [join(FIXTURES, 'photo.jpg')],
        params: { quality: 80 },
        outputPath: join(tmp, 'out.jpg'),
        timeoutMs: 0,
        proOrigin: 'https://wyreup.com',
        allowedRoots: '*',
        allowOverwrite: true,
        maxBytes: 500 * 1024 * 1024,
      });
      expect(r.ok).toBe(true);
    } finally {
      if (ORIG_PERMIT === undefined) delete process.env['WYREUP_ALLOW_DISABLE_TIMEOUT'];
      else process.env['WYREUP_ALLOW_DISABLE_TIMEOUT'] = ORIG_PERMIT;
    }
  });
});
