import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { createJobController } from '../src/jobs.js';
import { createServer } from '../src/server.js';
import { LIMITS, PilotError } from '../src/limits.js';

const args = { file: { download_url: 'https://files.example.test/x?INPUT_URL_CANARY', file_id: 'ID_CANARY' } };
const workerUrl = new URL('../dist/worker.js', import.meta.url);
const holdUrl = new URL('./fixtures/worker-hold.mjs', import.meta.url);
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('owned worker lifecycle and concurrency', () => {
  it('runs the built actual worker, verifies SHA/bytes, and returns no caller name/URL/ID', async () => {
    const source = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#557799' } }).jpeg().toBuffer();
    const controller = createJobController(new Set(), { workerUrl, download: () => Promise.resolve(Uint8Array.from(source).buffer) });
    const result = await controller.run('compress_image_to_size', args, new AbortController().signal);
    expect(Buffer.from(result.output.base64, 'base64')).toEqual(source);
    expect(result.details.output.bytes).toBe(source.length);
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });

  it('rejects excess requests, terminates on cancellation, then releases the slot', async () => {
    const controller = createJobController(new Set(), { workerUrl: holdUrl, download: () => Promise.resolve(new ArrayBuffer(1)) });
    const abort = new AbortController();
    const running = controller.run('strip_image_metadata', args, abort.signal);
    const observed = expect(running).rejects.toHaveProperty('code', 'CANCELLED');
    await tick();
    await expect(controller.run('strip_image_metadata', args, new AbortController().signal)).rejects.toHaveProperty('code', 'BUSY');
    abort.abort();
    await observed;
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(controller.run('strip_image_metadata', args, cancelled.signal)).rejects.toHaveProperty('code', 'CANCELLED');
  });

  it('clears the armed processing deadline and slot after timeout', async () => {
    vi.useFakeTimers();
    try {
      const controller = createJobController(new Set(), { workerUrl: holdUrl, download: () => Promise.resolve(new ArrayBuffer(1)) });
      const running = controller.run('strip_image_metadata', args, new AbortController().signal);
      const observed = expect(running).rejects.toHaveProperty('code', 'WORKER_TIMEOUT');
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(LIMITS.workerMs);
      await observed;
      expect(vi.getTimerCount()).toBe(0);
      const cancelled = new AbortController();
      cancelled.abort();
      await expect(controller.run('strip_image_metadata', args, cancelled.signal)).rejects.toHaveProperty('code', 'CANCELLED');
    } finally { vi.useRealTimers(); }
  });

  it('preserves cancellation during the download-to-worker handoff', async () => {
    const abort = new AbortController();
    const controller = createJobController(new Set(), {
      workerUrl: holdUrl,
      download: () => { abort.abort(); return Promise.resolve(new ArrayBuffer(1)); },
    });
    await expect(controller.run('strip_image_metadata', args, abort.signal)).rejects.toHaveProperty('code', 'CANCELLED');
  });
});

describe('transport shutdown', () => {
  it.each(['download', 'worker'] as const)('aborts active %s work on server transport close and releases its slot', async stage => {
    let started: (() => void) | undefined;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const controller = createJobController(new Set(), {
      workerUrl: holdUrl,
      download: async (_url, _hosts, _budget, signal) => {
        started?.();
        if (stage === 'worker') return new ArrayBuffer(1);
        return await new Promise<ArrayBuffer>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new PilotError('CANCELLED')), { once: true });
        });
      },
    });
    const server = createServer(new Set(), controller);
    const client = new Client({ name: 'shutdown-check', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const call = client.callTool({ name: 'strip_image_metadata', arguments: args });
    const observed = expect(call).rejects.toThrow();
    await ready;
    await tick();
    await server.close();
    await observed;
    await tick();
    await expect.poll(async () => {
      const signal = AbortSignal.abort();
      try { await controller.run('strip_image_metadata', args, signal); return 'unexpected-success'; }
      catch (error) { return error instanceof PilotError ? error.code : 'unexpected-error'; }
    }).toBe('CANCELLED');
    await client.close();
  });

  it('the actual built stdio process exits on EOF without a signal', async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url))], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.stdout.resume();
    const exit = new Promise<[number | null, NodeJS.Signals | null]>(resolve => child.once('exit', (code, signal) => resolve([code, signal])));
    const watchdog = setTimeout(() => child.kill('SIGTERM'), 3000);
    try {
      child.stdin.end();
      const [code, signal] = await exit;
      expect(signal).toBeNull();
      expect(code).toBe(0);
      expect(stderr).toBe('');
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    }
  });
});
