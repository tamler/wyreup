import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { buildingTools } from '../../src/utilities/building.js';
import { hardwareTools } from '../../src/utilities/hardware.js';
import { toolRunsOnSurface } from '../../src/registry.js';
import { validateUtilityParams } from '../../src/utilities/common.js';
import type { ParamFieldSchema, ToolModule, ToolRunContext } from '../../src/types.js';
const all = [...buildingTools, ...hardwareTools];
const browserOnly = new Set(['gamepad-tester', 'touchscreen-dead-zone-tester']);
const context = (): ToolRunContext => ({
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'building-source-contract',
  onProgress() {},
});
function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
}
describe('all44 building/hardware source tool contracts (registration excluded)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('declares44 distinct real tools,42 universal tools and two same-Window device tools', () => {
    expect(all).toHaveLength(44);
    expect(new Set(all.map((tool) => tool.id)).size).toBe(44);
    expect(all.filter((tool) => !browserOnly.has(tool.id))).toHaveLength(42);
    for (const tool of all) {
      expect(tool.slug).toBe(tool.id);
      expect(tool.cost).toBe('free');
      expect(tool.batchable).toBe(false);
      if (browserOnly.has(tool.id)) expect(tool.surfaces).toEqual(['web']);
      for (const surface of ['web', 'cli', 'mcp'] as const)
        expect(toolRunsOnSurface(tool as unknown as ToolModule, surface)).toBe(
          surface === 'web' || !browserOnly.has(tool.id),
        );
      expect(tool.input.min).toBe(tool.id === 'camera-shutter-count-checker' ? 1 : 0);
      expect(tool.input.max).toBe(tool.id === 'camera-shutter-count-checker' ? 1 : 0);
      expect(tool.defaults).toBeDefined();
      expect(tool.paramSchema).toBeDefined();
    }
  });
  it.each(all.filter((tool) => !browserOnly.has(tool.id)))(
    '$id runs actual frozen defaults without browser APIs/network or mutation',
    async (tool) => {
      const fetcher = vi.fn(() => {
        throw new Error('Universal arithmetic/parser must not fetch');
      });
      vi.stubGlobal('fetch', fetcher);
      vi.stubGlobal(
        'navigator',
        Object.defineProperty({}, 'getGamepads', {
          get() {
            throw new Error('Universal tools must not read gamepads');
          },
        }),
      );
      const original = structuredClone(tool.defaults),
        supplied = structuredClone(tool.defaults);
      freeze(supplied);
      const files =
        tool.id === 'camera-shutter-count-checker'
          ? [
              new File(
                [
                  await readFile(
                    new URL('../fixtures/shutter-count/D2H_3957.NEF', import.meta.url),
                  ),
                ],
                'D2H_3957.NEF',
              ),
            ]
          : [];
      const artifacts = await tool.run(files, supplied, context());
      const blobs = Array.isArray(artifacts) ? artifacts : [artifacts];
      expect(blobs).toHaveLength(1);
      expect(blobs[0]!.type).toBe('application/json');
      const result = JSON.parse(await blobs[0]!.text()) as unknown;
      const finite = (value: unknown): void => {
        if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
        else if (value && typeof value === 'object') Object.values(value).forEach(finite);
      };
      finite(result);
      expect(fetcher).not.toHaveBeenCalled();
      expect(supplied).toEqual(original);
      expect(tool.defaults).toEqual(original);
    },
  );
  it('keeps all schema/default keys exact and rejects every scalar fractional count', () => {
    for (const tool of all) {
      expect(Object.keys(tool.paramSchema!).sort()).toEqual(Object.keys(tool.defaults).sort());
      const schema: Record<string, ParamFieldSchema> = {};
      for (const [key, field] of Object.entries(tool.paramSchema!)) {
        if (!field) throw new Error(`${tool.id}.${key} must declare a schema`);
        schema[key] = field;
      }
      for (const [key, field] of Object.entries(schema)) {
        if (field.type !== 'number' || field.step !== 1) continue;
        const fractionalCount = (field.min ?? 0) + 0.5;
        expect(() =>
          validateUtilityParams(tool.defaults, schema, {
            [key]: fractionalCount,
          }),
        ).toThrow(/whole number/);
      }
    }
  });
  it.each(all)('$id rejects owned abort before progress or an artifact', async (tool) => {
    const ctx = context(),
      progress = vi.fn();
    ctx.onProgress = progress;
    const controller = new AbortController();
    controller.abort();
    ctx.signal = controller.signal;
    await expect((async () => tool.run([], {}, ctx))()).rejects.toMatchObject({ code: 'abort' });
    expect(progress).not.toHaveBeenCalled();
  });
});
