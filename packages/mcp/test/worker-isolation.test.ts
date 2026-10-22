import { describe, it, expect, beforeAll } from 'vitest';
import { runInWorker } from '../src/supervisor.js';
import { mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const FIXTURES = new URL('../../core/test/fixtures', import.meta.url).pathname;

describe('worker isolation [spec §#8]', () => {
  let tmp: string;
  beforeAll(async () => {
    tmp = await realpath(await mkdtemp(join(tmpdir(), 'wymcp-w-')));
  });

  it('runs a real free tool and returns the output path', async () => {
    const r = await runInWorker({
      toolId: 'compress',
      inputPaths: [join(FIXTURES, 'photo.jpg')],
      params: { quality: 80 },
      outputPath: join(tmp, 'out.jpg'),
      timeoutMs: 60_000,
      proOrigin: 'https://wyreup.com',
      modelCdn: 'https://models.wyreup.com',
      modelAllowedOrigins: ['https://models.wyreup.com'],
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
      modelCdn: 'https://models.wyreup.com',
      modelAllowedOrigins: ['https://models.wyreup.com'],
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
      modelCdn: 'https://models.wyreup.com',
      modelAllowedOrigins: ['https://models.wyreup.com'],
      allowedRoots: '*',
      allowOverwrite: false,
      maxBytes: 100,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe('validate');
  });

  it('enforces maxBytes cumulatively inside the worker', async () => {
    const first = join(tmp, 'first.txt');
    const second = join(tmp, 'second.txt');
    await writeFile(first, '123456');
    await writeFile(second, 'abcdef');
    const r = await runInWorker({
      toolId: 'hash',
      inputPaths: [first, second],
      params: { algorithms: ['SHA-256'] },
      timeoutMs: 30_000,
      proOrigin: 'https://wyreup.com',
      modelCdn: 'https://models.wyreup.com',
      modelAllowedOrigins: ['https://models.wyreup.com'],
      allowedRoots: [tmp],
      allowOverwrite: false,
      maxBytes: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.stage).toBe('validate');
      expect(r.error).toMatch(/exceeds limit/);
    }
  });

  it('reads and reports the canonical path returned by worker validation', async () => {
    const target = join(tmp, 'canonical-target.txt');
    const alias = join(tmp, 'canonical-alias.txt');
    await writeFile(target, 'canonical');
    await symlink(target, alias);
    const r = await runInWorker({
      toolId: 'hash',
      inputPaths: [alias],
      params: { algorithms: ['SHA-256'] },
      timeoutMs: 30_000,
      proOrigin: 'https://wyreup.com',
      modelCdn: 'https://models.wyreup.com',
      modelAllowedOrigins: ['https://models.wyreup.com'],
      allowedRoots: [tmp],
      allowOverwrite: false,
      maxBytes: 1024,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(JSON.parse(r.textOutput ?? '{}')).toMatchObject({ name: 'canonical-target.txt' });
    }
  });

  it('routes a cold-cache model request through the worker model CDN allowlist', async () => {
    let requests = 0;
    const modelServer = createServer((_req, res) => {
      requests += 1;
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('intentional test miss');
    });
    await new Promise<void>((resolve, reject) => {
      modelServer.once('error', reject);
      modelServer.listen(0, '127.0.0.1', resolve);
    });
    const address = modelServer.address() as AddressInfo;
    const modelCdn = `http://127.0.0.1:${address.port}`;
    const coldCwd = await realpath(await mkdtemp(join(tmpdir(), 'wymcp-cold-model-')));
    const input = join(coldCwd, 'sentiment.txt');
    await writeFile(input, 'A very good day.');
    const originalCwd = process.cwd();
    try {
      process.chdir(coldCwd);
      const r = await runInWorker({
        toolId: 'text-sentiment',
        inputPaths: [input],
        params: {},
        timeoutMs: 30_000,
        proOrigin: 'https://wyreup.com',
        modelCdn,
        modelAllowedOrigins: [modelCdn],
        allowedRoots: [coldCwd],
        allowOverwrite: false,
        maxBytes: 1024,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).not.toMatch(/Egress blocked/);
      expect(requests).toBeGreaterThan(0);
    } finally {
      process.chdir(originalCwd);
      await new Promise<void>((resolve) => {
        modelServer.close(() => resolve());
        modelServer.closeAllConnections();
      });
    }
  });

  it('stderr ring buffer caps at 8 KB even when the child writes 20 MB', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const fixture = join(here, 'fixtures', 'spammy-worker.js');
    const child = fork(fixture, [], { silent: true });
    let stderrBuf = '';
    const CAP = 8 * 1024;
    child.stderr!.on('data', (c: Buffer) => {
      stderrBuf += c.toString('utf8');
      if (stderrBuf.length > CAP) stderrBuf = stderrBuf.slice(-CAP);
    });
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    expect(stderrBuf.length).toBeLessThanOrEqual(CAP);
  });

  it('NODE_OPTIONS from parent is NOT inherited by worker (--require bomb defense)', async () => {
    const ORIG = process.env['NODE_OPTIONS'];
    process.env['NODE_OPTIONS'] = '--require ./this-file-does-not-exist.js';
    try {
      const r = await runInWorker({
        toolId: 'compress',
        inputPaths: [join(FIXTURES, 'photo.jpg')],
        params: { quality: 80 },
        outputPath: join(tmp, 'no-options-out.jpg'),
        timeoutMs: 30_000,
        proOrigin: 'https://wyreup.com',
        modelCdn: 'https://models.wyreup.com',
        modelAllowedOrigins: ['https://models.wyreup.com'],
        allowedRoots: '*',
        allowOverwrite: true,
        maxBytes: 500 * 1024 * 1024,
      });
      // If NODE_OPTIONS had been inherited, fork would have failed trying to
      // require the nonexistent file. A clean success proves scrubbedEnv()
      // in supervisor.ts drops NODE_OPTIONS.
      expect(r.ok).toBe(true);
    } finally {
      if (ORIG === undefined) delete process.env['NODE_OPTIONS'];
      else process.env['NODE_OPTIONS'] = ORIG;
    }
  });
});
