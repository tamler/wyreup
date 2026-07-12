import { describe, expect, it } from 'vitest';
import { tomlConvert } from '../../../src/tools/toml-convert/index.js';
import type { TomlConvertParams } from '../../../src/tools/toml-convert/types.js';
import type { ToolRunContext } from '../../../src/types.js';

const TOML = `title = "Example"
created = 1979-05-27T07:32:00Z
tags = ["dev", "config"]

[owner]
name = "Ada"
active = true
`;

interface ParsedTomlFixture {
  title: string;
  created: string;
  tags: string[];
  owner: { name: string; active: boolean };
}

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(text: string, params: TomlConvertParams = {}): Promise<Blob> {
  const input = new File([text], 'config.txt', { type: 'text/plain' });
  const [output] = (await tomlConvert.run([input], params, makeCtx())) as Blob[];
  return output!;
}

describe('toml-convert — metadata', () => {
  it('declares developer and conversion metadata', () => {
    expect(tomlConvert.category).toBe('dev');
    expect(tomlConvert.categories).toEqual(['dev', 'convert']);
    expect(tomlConvert.input.accept).toEqual([
      'text/plain',
      'application/json',
      'application/toml',
    ]);
    expect(tomlConvert.defaults).toEqual({ direction: 'auto', indent: 2 });
    expect(tomlConvert.description).toContain('date');
    expect(tomlConvert.llmDescription).toBeTruthy();
  });
});

describe('toml-convert — run()', () => {
  it('converts TOML tables, arrays, and dates to indented JSON', async () => {
    const output = await run(TOML, { direction: 'toml-to-json', indent: 4 });
    const parsed = JSON.parse(await output.text()) as ParsedTomlFixture;

    expect(output.type).toBe('application/json');
    expect(parsed).toMatchObject({
      title: 'Example',
      created: '1979-05-27T07:32:00.000Z',
      tags: ['dev', 'config'],
      owner: { name: 'Ada', active: true },
    });
    expect(await output.text()).toContain('    "title"');
  });

  it('auto-detects TOML and JSON in both directions', async () => {
    const jsonOutput = await run(TOML);
    expect(jsonOutput.type).toBe('application/json');
    expect(JSON.parse(await jsonOutput.text())).toMatchObject({ owner: { name: 'Ada' } });

    const tomlOutput = await run('{"title":"Example","tags":["dev"],"owner":{"name":"Ada"}}');
    expect(tomlOutput.type).toBe('application/toml');
    expect(await tomlOutput.text()).toContain('[owner]');
  });

  it('round-trips JSON tables and arrays through TOML', async () => {
    const source = { title: 'Example', tags: ['dev', 'config'], owner: { name: 'Ada' } };
    const tomlOutput = await run(JSON.stringify(source), { direction: 'json-to-toml' });
    const jsonOutput = await run(await tomlOutput.text(), { direction: 'toml-to-json' });
    expect(JSON.parse(await jsonOutput.text())).toEqual(source);
  });

  it('reports invalid input', async () => {
    await expect(run('not valid = [', { direction: 'toml-to-json' })).rejects.toThrow(
      'Invalid TOML',
    );
    await expect(run('{broken', { direction: 'json-to-toml' })).rejects.toThrow('Invalid JSON');
  });

  it('rejects an invalid conversion direction', async () => {
    await expect(run(TOML, { direction: 'yaml-to-json' as 'auto' })).rejects.toThrow(
      'Invalid conversion direction',
    );
  });
});
