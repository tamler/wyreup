import { describe, expect, it } from 'vitest';
import { createWyreupMcpServer } from '../src/server.js';

describe('actual public cron tool MCP schema', () => {
  it('advertises typed enum values and active string/count bounds', async () => {
    const server = await createWyreupMcpServer();
    const handlers = (
      server as unknown as {
        _requestHandlers: Map<
          string,
          (
            request: unknown,
            extra: unknown,
          ) => Promise<{
            tools: { name: string; inputSchema: Record<string, unknown> }[];
          }>
        >;
      }
    )._requestHandlers;
    const list = handlers.get('tools/list');
    if (!list) throw new Error('Missing actual tools/list handler.');
    const { tools } = await list({ method: 'tools/list', params: {} }, {});
    const cron = tools.find((tool) => tool.name === 'cron-from-text');
    expect(cron).toBeDefined();
    const properties = cron!.inputSchema.properties as Record<
      string,
      {
        properties: Record<string, Record<string, unknown>>;
        allOf?: unknown[];
      }
    >;
    expect(properties.params!.properties.mode).toMatchObject({ enum: ['text', 'fields'] });
    // Conditional bounds live in allOf, rather than rejecting inactive values unconditionally.
    expect(JSON.stringify(properties.params!.allOf)).toContain('"maxLength":128');
    expect(JSON.stringify(properties.params!.allOf)).toContain('"maximum":50');
    await server.close();
  });
});
