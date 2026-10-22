import { describe, expect, it } from 'vitest';
import { beautifyCode, codeBeautifier } from '../../src/utilities/code-beautifier.js';
import { UtilityInputError } from '../../src/utilities/common.js';
import { parseTextRows, textDeveloperTools } from '../../src/utilities/text-developer.js';
import type { ToolRunContext } from '../../src/types.js';

function context(): ToolRunContext {
  return {
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'text-source-correction-3',
    onProgress: () => {},
  };
}

function repeatedKeys(values: number, key = 'x'): string {
  return `{${Array.from({ length: values }, () => `${JSON.stringify(key)}:0`).join(',')}}`;
}

async function expectJsonLimit(text: string, code: 'depth' | 'budget'): Promise<void> {
  let error: unknown;
  try {
    await beautifyCode(text, 'json', context());
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(UtilityInputError);
  expect(error).toMatchObject({ field: '$input', code });
}

describe('text correction 3 — JSON values counted from original lexical input', () => {
  it('accepts exactly 100000 values while object keys do not count', async () => {
    const output = await beautifyCode(repeatedKeys(99999), 'json', context());
    expect(output.match(/"x"\s*:/g)).toHaveLength(99999);
  });

  it('refuses value100001 even when duplicate keys collapse to one property', async () => {
    await expectJsonLimit(repeatedKeys(100000), 'budget');
  });

  it('counts duplicate __proto__ keys as original JSON values without property lookup', async () => {
    await expectJsonLimit(repeatedKeys(100000, '__proto__'), 'budget');
  });

  it('accepts exactly 100000 array values including the root container', async () => {
    const text = `[${'0,'.repeat(99998)}0]`;
    expect(JSON.parse(await beautifyCode(text, 'json', context()))).toHaveLength(99999);
  });

  it('refuses value100001 in an array', async () => {
    await expectJsonLimit(`[${'0,'.repeat(99999)}0]`, 'budget');
  });

  it('counts an overwritten array subtree instead of only the final object tree', async () => {
    await expectJsonLimit(`{"x":[${'0,'.repeat(99999)}0],"x":0}`, 'budget');
  });

  it('counts string, boolean and null primitives as values too', async () => {
    await expectJsonLimit(`[${'"x",true,false,null,'.repeat(25000).slice(0, -1)}]`, 'budget');
  });

  it.each([
    ['array primitive at depth128', `${'['.repeat(128)}0${']'.repeat(128)}`],
    ['129 nested empty arrays, deepest value depth128', `${'['.repeat(129)}${']'.repeat(129)}`],
    ['object primitive at depth128', `${'{"k":'.repeat(128)}0${'}'.repeat(128)}`],
    [
      '129 nested empty objects, deepest value depth128',
      `${'{"k":'.repeat(128)}{}${'}'.repeat(128)}`,
    ],
  ])('accepts %s', async (_name, text) => {
    expect(JSON.parse(await beautifyCode(text, 'json', context()))).toEqual(JSON.parse(text));
  });

  it.each([
    ['array primitive at depth129', `${'['.repeat(129)}0${']'.repeat(129)}`],
    ['object primitive at depth129', `${'{"k":'.repeat(129)}0${'}'.repeat(129)}`],
    ['empty array value at depth129', `${'['.repeat(130)}${']'.repeat(130)}`],
    ['overwritten deep duplicate-key subtree', `{"k":${'['.repeat(129)}${']'.repeat(129)},"k":0}`],
  ])('refuses %s', async (_name, text) => {
    await expectJsonLimit(text, 'depth');
  });

  it('distinguishes escaped scalar strings and whitespace-delimited keys from structure', async () => {
    const values = ['[{}]:,', 'a\\', 'a"b', '\\"[', 'x\n\t\r', '__proto__'];
    const text = `{ "key" \t\r\n : [${values.map((value) => JSON.stringify(value)).join(' \n, ')} \t], "tail" : true }`;
    expect(JSON.parse(await beautifyCode(text, 'json', context()))).toEqual({
      key: values,
      tail: true,
    });
  });

  it('does not count brackets inside strings toward container depth', async () => {
    const text = JSON.stringify('['.repeat(200) + '}]"\\:,'.repeat(200));
    expect(JSON.parse(await beautifyCode(text, 'json', context()))).toBe(JSON.parse(text));
  });

  it('skips literal Unicode escapes inside strings without treating decoded brackets as syntax', async () => {
    const text = '{"k": ["\\u005b\\u007b\\u0022\\u005c"]}';
    expect(JSON.parse(await beautifyCode(text, 'json', context()))).toEqual({ k: ['[{"\\'] });
  });

  it('retains exact existing original JSON number lexemes', async () => {
    const text =
      '{"large":9007199254740993,"decimal":1.0,"exponent":1e2,"minusZero":-0,"huge":1e309}';
    const output = await beautifyCode(text, 'json', context());
    expect(output).toContain('9007199254740993');
    expect(output).toContain('1.0');
    expect(output).toContain('1e2');
    expect(output).toContain('-0');
    expect(output).toContain('1e309');
  });

  it('refuses genuinely invalid grammar and a real already-aborted signal', async () => {
    await expect(beautifyCode('{"a":0,}', 'json', context())).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      beautifyCode(repeatedKeys(100000), 'json', { ...context(), signal: controller.signal }),
    ).rejects.toMatchObject({ field: '$run', code: 'abort' });
  });

  it('enforces structure limits through the public code file artifact path too', async () => {
    const file = new File([`${'['.repeat(129)}0${']'.repeat(129)}`], 'deep.json', {
      type: 'application/json; charset=utf-8',
    });
    await expect(codeBeautifier.run([file], { language: 'json' }, context())).rejects.toMatchObject(
      {
        field: '$input',
        code: 'depth',
      },
    );
  });
});

class ObservedFile extends File {
  reads = 0;

  override arrayBuffer(): Promise<ArrayBuffer> {
    this.reads++;
    return super.arrayBuffer();
  }
}

const duplicateTool = textDeveloperTools.find(
  (tool) => tool.id === 'remove-duplicate-lines-online',
);
if (!duplicateTool) throw new Error('Missing actual duplicate-lines tool.');

describe('text correction 3 — MIME essence and strict UTF8 file facade', () => {
  it.each(['text/plain; charset=utf-8', 'text/plain', '', '; charset=utf-8'])(
    'accepts the same UTF8 bytes with MIME %s',
    async (type) => {
      const file = new ObservedFile(['Café\nCafé\n中文'], 'lines.txt', { type });
      const result = await duplicateTool.run([file], {}, context());
      const blob = Array.isArray(result) ? result[0] : result;
      expect(await blob!.text()).toBe('Café\n中文');
      expect(file.reads).toBe(1);
    },
  );

  it('rejects actual unknown MIME essence before reading', async () => {
    const file = new ObservedFile(['x\nx'], 'unknown.txt', {
      type: 'application/x-untrusted; charset=utf-8',
    });
    await expect(duplicateTool.run([file], {}, context())).rejects.toThrow(/type|mime/i);
    expect(file.reads).toBe(0);
  });

  it('does not infer charset conversion from MIME parameters', async () => {
    const file = new ObservedFile([new Uint8Array([0xe9])], 'latin1.txt', {
      type: 'text/plain; charset=iso-8859-1',
    });
    await expect(duplicateTool.run([file], {}, context())).rejects.toThrow(/UTF-8/i);
    expect(file.reads).toBe(1);
  });
});

describe('text correction 3 — auto delimiter quota diagnostics', () => {
  it('asks for explicit delimiter and names row/column quota when no candidate fits 10001 rows', () => {
    const text = Array.from({ length: 10001 }, () => 'a,b').join('\n');
    expect(() => parseTextRows(text, 'auto')).toThrow(/row|column/i);
    expect(() => parseTextRows(text, 'auto')).toThrow(/\blimit\b/i);
    expect(() => parseTextRows(text, 'auto')).toThrow(/explicit delimiter/i);
    expect(() => parseTextRows(text, 'comma')).toThrow(/row.*limit/i);
  });

  it('asks for explicit delimiter and names quota when no candidate fits 101 columns', () => {
    const text = Array.from({ length: 101 }, () => 'x').join(',');
    expect(() => parseTextRows(text, 'auto')).toThrow(/row|column/i);
    expect(() => parseTextRows(text, 'auto')).toThrow(/\blimit\b/i);
    expect(() => parseTextRows(text, 'auto')).toThrow(/explicit delimiter/i);
    expect(() => parseTextRows(text, 'comma')).toThrow(/column.*limit/i);
  });

  it('keeps actual multiple-candidate ambiguity distinct from quota', () => {
    expect(() => parseTextRows('a,b;c\nx,y;z', 'auto')).toThrow(/ambiguous/i);
    expect(() => parseTextRows('a,b;c\nx,y;z', 'auto')).not.toThrow(/\blimit\b/i);
  });

  it('accepts the sole good candidate even though the wrong delimiter hits its column quota', () => {
    expect(parseTextRows('a;b;c,d\nx;y;z,q', 'auto', 10000, 2)).toEqual([
      ['a;b;c', 'd'],
      ['x;y;z', 'q'],
    ]);
  });

  it('accepts exact row/column limits without losing records', () => {
    expect(parseTextRows('a,b\nc,d', 'auto', 2, 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});
