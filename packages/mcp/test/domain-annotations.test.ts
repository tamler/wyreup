/// <reference lib="dom" />
// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- The source fixture uses an existing ambient declaration with no runtime module.
/// <reference path="../../core/src/lib/tr46.d.ts" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Core from '@wyreup/core';
import type { ToolModule } from '@wyreup/core';
vi.mock('@wyreup/core', async (importOriginal) => {
  const actual = await importOriginal<typeof Core>();
  const { domainAgeChecker } = await import('../../core/src/utilities/domain-age');
  const runnable = domainAgeChecker as unknown as ToolModule;
  return {
    ...actual,
    createDefaultRegistry: () =>
      actual.createRegistry([
        runnable,
        {
          ...runnable,
          id: 'synthetic-local',
          description: 'Local math.',
          llmDescription: 'Local math.',
        },
        { ...runnable, id: 'domain-age-checker-other' },
        { ...runnable, id: 'synthetic-credit', cost: 'credit' },
      ]),
  };
});
import { createWyreupMcpServer } from '../src/server';
type Listed = {
  tools: { name: string; description: string; annotations: { openWorldHint: boolean } }[];
};
afterEach(() => {
  vi.unstubAllEnvs();
});
describe('MCP exact free-network annotation (test-injected registry)', () => {
  it.each([undefined, 'KEY_CANARY'])(
    'lists free domain lookup as open-world regardless of API key %#',
    async (key) => {
      vi.stubEnv('WYREUP_API_KEY', key);
      const server = await createWyreupMcpServer();
      const handlers = (
        server as unknown as {
          _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<Listed>>;
        }
      )._requestHandlers;
      const handler = handlers.get('tools/list');
      if (!handler) throw new Error('Missing actual tools/list handler.');
      const { tools } = await handler({ method: 'tools/list', params: {} }, {});
      expect(
        tools.find((tool) => tool.name === 'domain-age-checker')?.annotations.openWorldHint,
      ).toBe(true);
      expect(tools.find((tool) => tool.name === 'synthetic-local')?.annotations.openWorldHint).toBe(
        false,
      );
      expect(
        tools.find((tool) => tool.name === 'domain-age-checker-other')?.annotations.openWorldHint,
      ).toBe(false);
      expect(tools.find((tool) => tool.name === 'wyreup_chain')?.annotations.openWorldHint).toBe(
        true,
      );
      expect(tools.some((tool) => tool.name === 'synthetic-credit')).toBe(Boolean(key));
      if (key)
        expect(
          tools.find((tool) => tool.name === 'synthetic-credit')?.annotations.openWorldHint,
        ).toBe(true);
      expect(tools.find((tool) => tool.name === 'domain-age-checker')?.description).toMatch(
        /domain.*Wyreup.*registry/i,
      );
    },
  );
});
