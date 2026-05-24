import { describe, it, expect, beforeAll } from 'vitest';
import { runInWorker } from '../src/supervisor.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURES = new URL('../../core/test/fixtures', import.meta.url).pathname;

describe('worker isolation [spec §#8]', () => {
  let tmp: string;
  beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), 'wymcp-w-')); });

  it('runs a real free tool and returns the output path', async () => {
    const r = await runInWorker({
      toolId: 'compress',
      inputPaths: [join(FIXTURES, 'photo.jpg')],
      params: { quality: 80 },
      outputPath: join(tmp, 'out.jpg'),
      timeoutMs: 60_000,
      proOrigin: 'https://wyreup.com',
      allowedRoots: '*',
      allowOverwrite: true,
      maxBytes: 500 * 1024 * 1024,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.writtenPaths[0]).toBe(join(tmp, 'out.jpg'));
  });

  it('reports validate-stage error when path is outside allowlist', async () => {
    const r = await runInWorker({
      toolId: 'compress',
      inputPaths: ['/etc/passwd'],
      params: {},
      outputPath: join(tmp, 'x.jpg'),
      timeoutMs: 60_000,
      proOrigin: 'https://wyreup.com',
      allowedRoots: [tmp],
      allowOverwrite: true,
      maxBytes: 500 * 1024 * 1024,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe('validate');
  });

  it('reports an error for an unknown tool ID', async () => {
    const r = await runInWorker({
      toolId: 'no-such-tool',
      inputPaths: [],
      params: {},
      timeoutMs: 30_000,
      proOrigin: 'https://wyreup.com',
      allowedRoots: '*',
      allowOverwrite: false,
      maxBytes: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe('validate');
  });
});
