import { describe, expect, it } from 'vitest';
import { csvJson } from '../../../src/tools/csv-json/index';
import type { ToolRunContext } from '../../../src/types';
const ctx = (): ToolRunContext => ({
  onProgress() {},
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'delimiter-extension',
});
async function run(text: string, params: Record<string, unknown> = {}) {
  const output = await csvJson.run(
    [new File([text], 'input.csv', { type: 'text/csv' })],
    { direction: 'csv-to-csv', ...params },
    ctx(),
  );
  return (Array.isArray(output) ? output[0]! : output).text();
}
describe('explicit delimiter conversion', () => {
  it('preserves multiline fields, quoted delimiters, numeric strings and a final CRLF', async () => {
    expect(await run('a,b\r\n"x,y",""\r\n"line1\nline2",03\r\n', { targetDelimiter: '\t' })).toBe(
      '"a"\t"b"\r\n"x,y"\t""\r\n"line1\nline2"\t"03"\r\n',
    );
  });
  it('preserves duplicate headings, ragged arity, final blank records and all values', async () => {
    expect(await run('a,a\n0,01,x\n\n', { targetDelimiter: ';' })).toBe(
      '"a";"a"\n"0";"01";"x"\n""\n',
    );
    expect(await run('"a"\n""')).toBe('"a"\n""');
    expect(await run('a\n')).toBe('"a"\n');
    expect(await run('a')).toBe('"a"');
  });
  it('uses explicit delimiters and record-newline choices without changing embedded newlines', async () => {
    expect(
      await run('a;b\r\n"x\ny";z', {
        sourceDelimiter: ';',
        targetDelimiter: '|',
        recordNewline: 'lf',
      }),
    ).toBe('"a"|"b"\n"x\ny"|"z"');
    expect(await run('a\tb\n1\t2\n', { sourceDelimiter: '\t', recordNewline: 'crlf' })).toBe(
      '"a","b"\r\n"1","2"\r\n',
    );
    expect(await run('a;b')).toBe('"a;b"');
  });
  it.each([{ sourceDelimiter: 'auto' }, { targetDelimiter: '::' }, { recordNewline: 'native' }])(
    'rejects invalid conversion options %j',
    async (params) => {
      await expect(run('a,b', params)).rejects.toThrow();
    },
  );
  it('surfaces malformed CSV quoting and enforces bounded rows, columns and bytes', async () => {
    await expect(run('a,b\n"unterminated,b')).rejects.toThrow('CSV');
    await expect(run(Array.from({ length: 10001 }, () => 'a').join('\n'))).rejects.toThrow('10000');
    expect(await run(Array.from({ length: 10000 }, () => 'a').join('\n') + '\n')).toHaveLength(
      40000,
    );
    await expect(run(Array.from({ length: 101 }, () => 'a').join(','))).rejects.toThrow('100');
    await expect(run('x'.repeat(5 * 1024 * 1024 + 1))).rejects.toThrow('5 MiB');
  });
  it('settles cancellation before emitting a done event', async () => {
    const c = new AbortController();
    c.abort();
    const stages: string[] = [];
    await expect(
      csvJson.run(
        [new File(['a'], 'input.csv')],
        { direction: 'csv-to-csv' },
        { ...ctx(), signal: c.signal, onProgress: (p) => stages.push(p.stage) },
      ),
    ).rejects.toThrow('Aborted');
    expect(stages).not.toContain('done');
  });
});
