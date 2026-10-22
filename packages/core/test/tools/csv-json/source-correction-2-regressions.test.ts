import { describe, expect, it } from 'vitest';
import { csvJson } from '../../../src/tools/csv-json/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function context(): ToolRunContext {
  return {
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'csv-source-correction-2',
    onProgress: () => {},
  };
}

async function convert(text: string): Promise<string> {
  const output = await csvJson.run(
    [new File([text], 'mixed.csv', { type: 'text/csv' })],
    {
      direction: 'csv-to-csv',
      sourceDelimiter: ',',
      targetDelimiter: '\t',
      recordNewline: 'lf',
    },
    context(),
  );
  const blob = Array.isArray(output) ? output[0] : output;
  if (!blob) throw new Error('Missing complete delimiter conversion artifact.');
  return blob.text();
}

describe('CSV source correction 2 — mixed terminators never delete real records', () => {
  it.each([
    ['a,b\r\nc,d\n', '"a"\t"b"\n"c"\t"d\n"'],
    ['a\nb\r', '"a"\n"b\r"'],
  ])(
    'preserves every parsed field in %j or reports an explicit CSV refusal',
    async (input, expected) => {
      let output: string;
      try {
        output = await convert(input);
      } catch (cause) {
        expect(cause).toBeInstanceOf(Error);
        if (!(cause instanceof Error)) throw cause;
        expect(cause.message).toMatch(/CSV|newline|terminator|record/i);
        return;
      }
      expect(output).toBe(expected);
    },
  );

  it('removes only the final phantom while retaining an actual trailing blank record', async () => {
    expect(await convert('a,b\r\n\r\n')).toBe('"a"\t"b"\n""\n');
  });

  it('preserves interior blank records and one true matched final terminator', async () => {
    expect(await convert('a,b\r\n\r\nc,d\r\n')).toBe('"a"\t"b"\n""\n"c"\t"d"\n');
  });

  it('preserves literal LF and CR inside quoted fields', async () => {
    expect(await convert('a,b\r\n"line1\nline2","left\rright"\r\n')).toBe(
      '"a"\t"b"\n"line1\nline2"\t"left\rright"\n',
    );
  });
});
