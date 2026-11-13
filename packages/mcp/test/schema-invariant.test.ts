import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDefaultRegistry, type ToolRunContext } from '@wyreup/core';
import { createWyreupMcpServer } from '../src/server.js';

const ALLOWED_TOP_LEVEL_FIELDS = new Set([
  'input_paths',
  'output_path',
  'output_dir',
  'params',
  'timeout_ms',
  'allow_overwrite',
  // A UUID control for paid request recovery, never a path or tool parameter.
  'request_key',
  'steps',
]);

describe('MCP input schema invariant [spec § Schema invariant]', () => {
  const ORIG_KEY = process.env['WYREUP_API_KEY'];
  const ORIG_ALLOW = process.env['WYREUP_ALLOW_PATHS'];

  beforeAll(() => {
    process.env['WYREUP_API_KEY'] = 'wk_test_schema';
    process.env['WYREUP_ALLOW_PATHS'] = tmpdir();
  });
  afterAll(() => {
    if (ORIG_KEY === undefined) delete process.env['WYREUP_API_KEY'];
    else process.env['WYREUP_API_KEY'] = ORIG_KEY;
    if (ORIG_ALLOW === undefined) delete process.env['WYREUP_ALLOW_PATHS'];
    else process.env['WYREUP_ALLOW_PATHS'] = ORIG_ALLOW;
  });

  async function listTools() {
    const srv = await createWyreupMcpServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = (srv as any)._requestHandlers as Map<
      string,
      (req: unknown, extra: unknown) => unknown
    >;
    const handler = handlers.get('tools/list')!;
    return handler({ method: 'tools/list', params: {} }, {}) as Promise<{
      tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>;
    }>;
  }

  it('no tool declares a path field outside the closed set', async () => {
    const list = await listTools();
    for (const tool of list.tools) {
      const props = tool.inputSchema?.properties ?? {};
      for (const key of Object.keys(props)) {
        expect(
          ALLOWED_TOP_LEVEL_FIELDS.has(key),
          `Tool ${tool.name} declares unexpected top-level field "${key}". Path fields must be input_paths/output_path/output_dir only.`,
        ).toBe(true);
      }
    }
  });

  it('every tool declares timeout_ms', async () => {
    const list = await listTools();
    for (const tool of list.tools) {
      expect(tool.inputSchema?.properties, `tool=${tool.name}`).toHaveProperty('timeout_ms');
    }
  });

  it('every tool declares allow_overwrite', async () => {
    const list = await listTools();
    for (const tool of list.tools) {
      expect(tool.inputSchema?.properties, `tool=${tool.name}`).toHaveProperty('allow_overwrite');
    }
  });

  it('exposes a constrained request key only on paid tools', async () => {
    const registry = createDefaultRegistry();
    const list = await listTools();
    for (const tool of list.tools) {
      const field = tool.inputSchema?.properties?.['request_key'] as
        | { type?: string; pattern?: string; minLength?: number; maxLength?: number }
        | undefined;
      const paid = registry.toolsById.get(tool.name)?.cost === 'credit';
      if (!paid) {
        expect(field, `tool=${tool.name}`).toBeUndefined();
        continue;
      }
      expect(field, `tool=${tool.name}`).toMatchObject({ type: 'string', minLength: 36, maxLength: 36 });
      expect(typeof field?.pattern).toBe('string');
      const valid = new RegExp(field!.pattern!);
      expect(valid.test('aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82')).toBe(true);
      expect(valid.test('/etc/passwd')).toBe(false);
      expect(valid.test('aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82/../../secret')).toBe(false);
    }
  });

  it('keeps the request key out of file paths and tool parameters', async () => {
    const previous = process.env['WYREUP_DISABLE_WORKER_ISOLATION'];
    process.env['WYREUP_DISABLE_WORKER_ISOLATION'] = '1';
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'wyreup-schema-key-')));
    const input = join(directory, 'input.txt');
    const key = 'aa097a65-0c3a-4dc0-9ad3-c9cf1bd0df82';
    await writeFile(input, 'fixture');
    const server = await createWyreupMcpServer();
    const run = vi.fn((files: File[], params: unknown, ctx: ToolRunContext) => {
      expect(files.map(file => file.name)).toEqual(['input.txt']);
      expect(params).toEqual({});
      expect(ctx.proRequestKey).toBe(key);
      return Promise.resolve(new Blob(['ok'], { type: 'text/plain' }));
    });
    const internals = server as unknown as {
      __wyreupRegistry: { toolsById: Map<string, unknown> };
      _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>>;
    };
    internals.__wyreupRegistry.toolsById.set('test-request-key', {
      id: 'test-request-key', slug: 'test-request-key', name: 'Fixture', description: 'Fixture',
      category: 'text', keywords: [], defaults: {}, input: { accept: ['text/plain'], min: 1, max: 1 },
      output: { mime: 'text/plain' }, interactive: false, batchable: false, cost: 'credit', memoryEstimate: 'low', run,
    });
    const call = internals._requestHandlers.get('tools/call');
    if (!call) throw new Error('Missing tools/call handler');
    try {
      const valid = await call({ method: 'tools/call', params: { name: 'test-request-key', arguments: { input_paths: [input], params: {}, request_key: key } } }, {});
      expect(valid.isError).toBeFalsy();
      expect(run).toHaveBeenCalledTimes(1);
      const invalid = await call({ method: 'tools/call', params: { name: 'test-request-key', arguments: { input_paths: [input], params: {}, request_key: '/etc/passwd' } } }, {});
      expect(invalid.isError).toBe(true);
      expect(invalid.content[0]?.text).toContain('UUID v4');
      const newline = await call({ method: 'tools/call', params: { name: 'test-request-key', arguments: { input_paths: [input], params: {}, request_key: `${key}\n` } } }, {});
      expect(newline.isError).toBe(true);
      expect(newline.content[0]?.text).toContain('UUID v4');
      const outside = await call({ method: 'tools/call', params: { name: 'test-request-key', arguments: { input_paths: ['/etc/passwd'], params: {}, request_key: key } } }, {});
      expect(outside.isError).toBe(true);
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
      if (previous === undefined) delete process.env['WYREUP_DISABLE_WORKER_ISOLATION'];
      else process.env['WYREUP_DISABLE_WORKER_ISOLATION'] = previous;
    }
  });
});
