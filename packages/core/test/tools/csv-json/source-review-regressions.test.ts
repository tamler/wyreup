import { describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '../../../src/types.js';
import { csvJson, type CsvJsonParams } from '../../../src/tools/csv-json/index.js';

describe('independent direct CSV direction validation', () => {
  it.each(['csv-to-csv ', 'delimiter', 'json-to-csv ', ''])(
    'rejects invalid direction %j before input read or progress',
    async (direction) => {
      const file = new File(['[{"a":"1"}]'], 'input.json', { type: 'application/json' });
      const read = vi.spyOn(file, 'text');
      const onProgress = vi.fn();
      const context: ToolRunContext = {
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: 'independent-csv-source-regressions',
        onProgress,
      };
      try {
        const params = { direction } as unknown as CsvJsonParams;
        const failure: unknown = await csvJson.run([file], params, context).then(
          () => null,
          (error: unknown) => error,
        );
        expect.soft(failure).toBeInstanceOf(Error);
        expect
          .soft(failure instanceof Error ? failure.message : String(failure))
          .toMatch(/direction/i);
        expect.soft(read).not.toHaveBeenCalled();
        expect.soft(onProgress).not.toHaveBeenCalled();
      } finally {
        read.mockRestore();
      }
    },
  );
  it.each([
    [undefined, 'a\n1', '[\n  {\n    "a": "1"\n  }\n]'],
    ['auto', 'a\n1', '[\n  {\n    "a": "1"\n  }\n]'],
    ['csv-to-json', 'a\n1', '[\n  {\n    "a": "1"\n  }\n]'],
    ['json-to-csv', '[{"a":"1"}]', 'a\n1'],
    ['csv-to-csv', 'a\n1', '"a"\n"1"'],
  ] as const)('retains supported direction %s', async (direction, input, expected) => {
    const result = await csvJson.run(
      [new File([input], 'input.txt', { type: 'text/plain' })],
      { direction },
      {
        signal: new AbortController().signal,
        cache: new Map(),
        executionId: 'independent-csv-direction-controls',
        onProgress() {},
      },
    );
    const artifacts = Array.isArray(result) ? result : [result];
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.type).toBe('text/plain');
    expect(await artifacts[0]!.text()).toBe(expected);
  });
});
