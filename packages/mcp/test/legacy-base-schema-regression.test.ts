import { expect, it } from 'vitest';
import { createDefaultRegistry } from '@wyreup/core';
import { projectToolParamsSchema } from '../src/param-schema';

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected schema object.');
  return value as Record<string, unknown>;
}

it('describes supported typed base presets and retains the full known-answer JSON output', async () => {
  const tool = createDefaultRegistry().toolsById.get('number-base-converter')!;
  const params = { ...record(tool.defaults), conversionKind: 'numeric', inputBase: 2 };
  const output = await tool.run([new File(['10'], 'number.txt', { type: 'text/plain' })], params, {
    signal: new AbortController().signal,
    executionId: crypto.randomUUID(),
    cache: new Map(),
    onProgress() {},
  });
  const blobs = Array.isArray(output) ? output : [output];
  const artifact: unknown = JSON.parse(await blobs[0]!.text());
  expect(artifact).toEqual({
    decimal: '2',
    binary: '10',
    octal: '2',
    hexadecimal: '2',
    binaryPadded: '00000010',
    hexPadded: '02',
  });
  expect(blobs[0]!.type).toBe('application/json');
  const schema = projectToolParamsSchema(tool);
  const rules: unknown[] = Array.isArray(schema.allOf) ? schema.allOf : [];
  const activeInput = rules
    .map((rule) => record(record(record(rule).then).properties).inputBase)
    .find((value) => value !== undefined);
  expect(record(activeInput).enum).toEqual(['auto', 2, 8, 10, 16]);
  expect(record(record(schema.properties).inputBase).enum).toBeUndefined();
  expect(record(schema.properties).outputBase).toBeUndefined();
  await expect(
    tool.run(
      [new File(['10'], 'number.txt', { type: 'text/plain' })],
      { ...params, inputBase: 3 },
      {
        signal: new AbortController().signal,
        executionId: crypto.randomUUID(),
        cache: new Map(),
        onProgress() {},
      },
    ),
  ).rejects.toThrow('Unsupported base: 3');
});
