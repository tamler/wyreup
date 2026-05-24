import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { createWyreupMcpServer } from '../src/server.js';

const ALLOWED_TOP_LEVEL_FIELDS = new Set([
  'input_paths', 'output_path', 'output_dir',
  'params', 'timeout_ms', 'allow_overwrite',
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
    const handlers = (srv as any)._requestHandlers as Map<string, (req: unknown, extra: unknown) => unknown>;
    const handler = handlers.get('tools/list')!;
    return handler({ method: 'tools/list', params: {} }, {}) as Promise<{ tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }> }>;
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
});
