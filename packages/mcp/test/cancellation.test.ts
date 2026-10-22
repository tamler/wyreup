import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { runInWorker } from '../src/supervisor.js';
import type { WorkerJob } from '../src/worker-types.js';
import { mkdtemp, realpath, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicPublish } from '../src/atomic-publish.js';
import { createWyreupMcpServer } from '../src/server.js';
import type { ToolRunContext } from '@wyreup/core';

vi.mock('node:child_process', () => ({ fork: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const job: WorkerJob = { toolId: 'hash', inputPaths: [], params: {}, timeoutMs: 0,
  proOrigin: 'https://wyreup.com', modelCdn: null, modelAllowedOrigins: [], allowedRoots: '*', allowOverwrite: false, maxBytes: 1024 };

describe('worker client cancellation', () => {
  it('does not fork an already-cancelled request', async () => {
    vi.mocked(fork).mockClear();
    const result = await runInWorker(job, AbortSignal.abort());
    expect(result.ok).toBe(false);
    expect(fork).not.toHaveBeenCalled();
  });
  it('terminates only its own child, ignores late success and removes the abort listener', async () => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), send: vi.fn(), kill: vi.fn() });
    vi.mocked(fork).mockReturnValue(child as unknown as ReturnType<typeof fork>);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = runInWorker(job, controller.signal);
    controller.abort();
    child.emit('message', { ok: true, writtenPaths: ['late-output'] });
    child.emit('exit', null, 'SIGTERM');
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cancel/i);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('cancelled output publication', () => {
  it('does not commit an output when cancelled after directory validation', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'wyreup-cancel-')));
    try {
      const target = join(directory, 'output.txt');
      const controller = new AbortController();
      const result = await atomicPublish(target, new Uint8Array([1]), false,
        { afterParentValidation: () => { controller.abort(); return Promise.resolve(); } }, controller.signal);
      expect(result).toMatch(/cancel/i);
      await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('propagates SDK cancellation into chains and refuses a late tool output', async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'wyreup-chain-cancel-')));
    vi.stubEnv('WYREUP_ALLOW_PATHS', directory);
    const controller = new AbortController();
    const server = await createWyreupMcpServer();
    const internals = server as unknown as {
      __wyreupRegistry: { toolsById: Map<string, unknown> };
      _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<{ isError?: boolean }>>;
    };
    let observedSignal: AbortSignal | undefined;
    internals.__wyreupRegistry.toolsById.set('test-cancel-gen', {
      id: 'test-cancel-gen', name: 'Cancellation fixture', defaults: {},
      input: { accept: [], min: 0, max: 0 }, output: { mime: 'text/plain' },
      interactive: false, batchable: false, cost: 'free', memoryEstimate: 'low',
      run: (_inputs: File[], _params: unknown, ctx: ToolRunContext) => {
        observedSignal = ctx.signal;
        controller.abort();
        return Promise.resolve(new Blob(['late'], { type: 'text/plain' }));
      },
    });
    try {
      const target = join(directory, 'late.txt');
      const result = await internals._requestHandlers.get('tools/call')!({ method: 'tools/call', params: {
        name: 'wyreup_chain', arguments: { steps: 'test-cancel-gen', output_path: target },
      } }, { signal: controller.signal });
      expect(result.isError).toBe(true);
      expect(observedSignal?.aborted).toBe(true);
      await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
