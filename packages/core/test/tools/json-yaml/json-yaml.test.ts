import { describe, it, expect } from 'vitest';
import { jsonYaml } from '../../../src/tools/json-yaml/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { JsonYamlParams } from '../../../src/tools/json-yaml/index.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(text: string, params: JsonYamlParams = {}): Promise<string> {
  const file = new File([text], 'input.txt', { type: 'text/plain' });
  const [out] = await jsonYaml.run([file], params, makeCtx()) as Blob[];
  return out!.text();
}

describe('json-yaml — metadata', () => {
  it('has id json-yaml', () => {
    expect(jsonYaml.id).toBe('json-yaml');
  });

  it('is in the dev category', () => {
    expect(jsonYaml.category).toBe('dev');
  });

  it('outputs text/plain', () => {
    expect(jsonYaml.output.mime).toBe('text/plain');
  });
});

describe('json-yaml — run()', () => {
  it('converts JSON to YAML (auto)', async () => {
    const result = await run('{"name":"Alice","age":30}');
    expect(result).toContain('name: Alice');
    expect(result).toContain('age: 30');
  });

  it('converts YAML to JSON (auto)', async () => {
    const result = await run('name: Alice\nage: 30\n');
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(parsed['name']).toBe('Alice');
    expect(parsed['age']).toBe(30);
  });

  it('explicit json-to-yaml direction', async () => {
    const result = await run('{"x":1}', { direction: 'json-to-yaml' });
    expect(result).toContain('x: 1');
  });

  it('explicit yaml-to-json direction', async () => {
    const result = await run('x: 1\n', { direction: 'yaml-to-json' });
    expect(JSON.parse(result)).toEqual({ x: 1 });
  });

  it('throws on invalid JSON', async () => {
    await expect(run('{bad json}', { direction: 'json-to-yaml' })).rejects.toThrow('Invalid JSON');
  });

  it('throws on invalid YAML', async () => {
    await expect(run(': bad: yaml: [\n', { direction: 'yaml-to-json' })).rejects.toThrow('Invalid YAML');
  });

  it('handles nested objects', async () => {
    const json = JSON.stringify({ a: { b: { c: 42 } } });
    const result = await run(json);
    expect(result).toContain('c: 42');
  });
});
