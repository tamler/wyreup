import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { createWyreupMcpServer } from '../src/server.js';

describe('MCP capability annotations [spec §#2]', () => {
  const ORIG_KEY = process.env['WYREUP_API_KEY'];
  const ORIG_ALLOW = process.env['WYREUP_ALLOW_PATHS'];

  beforeAll(() => {
    process.env['WYREUP_API_KEY'] = 'wk_test_anno';
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
    // The MCP SDK Protocol stores handlers in _requestHandlers (private).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const handlers = (srv as any)._requestHandlers as Map<string, (req: unknown, extra: unknown) => unknown>;
    const handler = handlers.get('tools/list');
    if (!handler) throw new Error('No tools/list handler');
    return handler({ method: 'tools/list', params: {} }, {}) as Promise<{ tools: Array<{ name: string; annotations?: Record<string, unknown> }> }>;
  }

  it('every tool exposes all four annotations', async () => {
    const list = await listTools();
    for (const tool of list.tools) {
      expect(tool.annotations, `tool=${tool.name}`).toBeDefined();
      expect(tool.annotations!['readOnlyHint']).toBe(false);
      expect(tool.annotations!['destructiveHint']).toBe(false);
      expect(typeof tool.annotations!['idempotentHint']).toBe('boolean');
      expect(typeof tool.annotations!['openWorldHint']).toBe('boolean');
    }
  });

  it('openWorldHint matches cost === "credit"', async () => {
    const { createDefaultRegistry } = await import('@wyreup/core');
    const list = await listTools();
    const reg = createDefaultRegistry();
    for (const tool of list.tools) {
      if (tool.name === 'wyreup_chain') continue;
      const t = reg.toolsById.get(tool.name);
      if (!t) continue;
      expect(tool.annotations!['openWorldHint'], `tool=${tool.name}`).toBe(t.cost === 'credit');
    }
  });

  it('wyreup_chain advertises worst-case annotations', async () => {
    const list = await listTools();
    const chain = list.tools.find((t) => t.name === 'wyreup_chain');
    expect(chain).toBeDefined();
    expect(chain!.annotations!['idempotentHint']).toBe(false);
    expect(chain!.annotations!['openWorldHint']).toBe(true);
  });
});
