import { describe, it, expect } from 'vitest';
import { csvJson } from '../../../src/tools/csv-json/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { CsvJsonParams } from '../../../src/tools/csv-json/index.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(text: string, params: CsvJsonParams = {}): Promise<string> {
  const file = new File([text], 'input.txt', { type: 'text/plain' });
  const [out] = await csvJson.run([file], params, makeCtx()) as Blob[];
  return out!.text();
}

describe('csv-json — metadata', () => {
  it('has id csv-json', () => {
    expect(csvJson.id).toBe('csv-json');
  });

  it('is in the dev category', () => {
    expect(csvJson.category).toBe('dev');
  });
});

describe('csv-json — run()', () => {
  it('converts CSV to JSON objects (auto)', async () => {
    const csv = 'name,age\nAlice,30\nBob,25';
    const result = JSON.parse(await run(csv)) as unknown[];
    expect(result).toHaveLength(2);
    expect((result[0] as Record<string, string>)['name']).toBe('Alice');
    expect((result[0] as Record<string, string>)['age']).toBe('30');
  });

  it('converts CSV to arrays when arrayStyle=arrays', async () => {
    const csv = 'name,age\nAlice,30';
    const result = JSON.parse(await run(csv, { arrayStyle: 'arrays' })) as unknown[][];
    expect(result[0]).toEqual(['name', 'age']);
    expect(result[1]).toEqual(['Alice', '30']);
  });

  it('converts JSON to CSV (auto)', async () => {
    const json = JSON.stringify([{ name: 'Alice', age: 30 }]);
    const result = await run(json);
    expect(result).toContain('name,age');
    expect(result).toContain('Alice,30');
  });

  it('handles quoted fields with commas', async () => {
    const csv = 'name,bio\nAlice,"Hello, World"';
    const result = JSON.parse(await run(csv)) as unknown[];
    expect((result[0] as Record<string, string>)['bio']).toBe('Hello, World');
  });

  it('supports custom delimiter', async () => {
    const csv = 'name;age\nAlice;30';
    const result = JSON.parse(await run(csv, { delimiter: ';' })) as unknown[];
    expect((result[0] as Record<string, string>)['name']).toBe('Alice');
  });

  it('throws on invalid JSON input in json-to-csv mode', async () => {
    await expect(run('{bad}', { direction: 'json-to-csv' })).rejects.toThrow('Invalid JSON');
  });

  it('throws on non-array JSON input', async () => {
    await expect(run('{"key":"val"}', { direction: 'json-to-csv' })).rejects.toThrow('array');
  });
});
