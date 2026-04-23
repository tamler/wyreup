import { describe, it, expect } from 'vitest';
import { excelInfo } from '../../../src/tools/excel-info/index.js';
import { makeCtx, makeXlsxFile, makeMultiSheetXlsxFile } from '../excel-helpers.js';

interface ExcelInfoResult {
  sheetCount: number;
  sheetNames: string[];
  totalCells: number;
  perSheet: { name: string; rows: number; cols: number; preview: unknown[][] }[];
}

async function run(file: File): Promise<ExcelInfoResult> {
  const blob = (await excelInfo.run([file], {}, makeCtx())) as Blob;
  return JSON.parse(await blob.text()) as ExcelInfoResult;
}

// ── Metadata ──────────────────────────────────────────────────────────────────

describe('excel-info — metadata', () => {
  it('has id excel-info', () => expect(excelInfo.id).toBe('excel-info'));
  it('is in inspect category', () => expect(excelInfo.category).toBe('inspect'));
  it('outputs application/json', () => expect(excelInfo.output.mime).toBe('application/json'));
  it('does not define paramSchema (no params)', () => {
    // paramSchema is optional — absence is fine for no-param tools
    expect(excelInfo.defaults).toEqual({});
  });
});

// ── run() ─────────────────────────────────────────────────────────────────────

describe('excel-info — run()', () => {
  it('returns sheetCount', async () => {
    const file = makeXlsxFile([['a', 'b'], [1, 2]]);
    const result = await run(file);
    expect(result.sheetCount).toBe(1);
  });

  it('returns sheetNames', async () => {
    const file = makeMultiSheetXlsxFile([
      { name: 'Alpha', rows: [['a'], [1]] },
      { name: 'Beta', rows: [['b'], [2]] },
    ]);
    const result = await run(file);
    expect(result.sheetNames).toContain('Alpha');
    expect(result.sheetNames).toContain('Beta');
    expect(result.sheetCount).toBe(2);
  });

  it('returns row and column counts per sheet', async () => {
    const file = makeXlsxFile([
      ['x', 'y', 'z'],
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const result = await run(file);
    const sheet = result.perSheet[0]!;
    expect(sheet.rows).toBe(3);
    expect(sheet.cols).toBe(3);
  });

  it('returns preview of first 5 rows', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => [i + 1]);
    const file = makeXlsxFile(rows);
    const result = await run(file);
    expect(result.perSheet[0]!.preview).toHaveLength(5);
  });

  it('returns totalCells', async () => {
    const file = makeXlsxFile([['a', 'b'], [1, 2]]);
    const result = await run(file);
    expect(result.totalCells).toBe(4); // 2 rows x 2 cols
  });

  it('output is valid JSON', async () => {
    const file = makeXlsxFile([['col'], ['val']]);
    const result = await excelInfo.run([file], {}, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    const text = await blob.text();
    expect(() => { JSON.parse(text); }).not.toThrow();
  });
});
