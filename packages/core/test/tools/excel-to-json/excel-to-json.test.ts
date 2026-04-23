import { describe, it, expect } from 'vitest';
import { excelToJson } from '../../../src/tools/excel-to-json/index.js';
import { makeCtx, makeXlsxFile, makeMultiSheetXlsxFile } from '../excel-helpers.js';

const ROWS = [
  ['name', 'score'],
  ['Alice', 95],
  ['Bob', 82],
];

async function run(file: File, params = {}): Promise<{ sheets: Record<string, unknown[]> }> {
  const blob = (await excelToJson.run([file], params, makeCtx())) as Blob;
  return JSON.parse(await blob.text()) as { sheets: Record<string, unknown[]> };
}

// ── Metadata ──────────────────────────────────────────────────────────────────

describe('excel-to-json — metadata', () => {
  it('has id excel-to-json', () => expect(excelToJson.id).toBe('excel-to-json'));
  it('is in convert category', () => expect(excelToJson.category).toBe('convert'));
  it('outputs application/json', () => expect(excelToJson.output.mime).toBe('application/json'));
  it('has paramSchema', () => expect(excelToJson.paramSchema).toBeDefined());
});

// ── run() ─────────────────────────────────────────────────────────────────────

describe('excel-to-json — run()', () => {
  it('converts sheet to array of objects by default', async () => {
    const file = makeXlsxFile(ROWS);
    const result = await run(file);
    expect(result.sheets['Sheet1']).toHaveLength(2);
    expect((result.sheets['Sheet1']![0] as Record<string, unknown>)['name']).toBe('Alice');
    expect((result.sheets['Sheet1']![0] as Record<string, unknown>)['score']).toBe(95);
  });

  it('wraps output in {sheets} envelope', async () => {
    const file = makeXlsxFile(ROWS);
    const result = await run(file);
    expect(typeof result.sheets).toBe('object');
    expect('Sheet1' in result.sheets).toBe(true);
  });

  it('exports all sheets when sheet=all (default)', async () => {
    const file = makeMultiSheetXlsxFile([
      { name: 'A', rows: [['x'], [1]] },
      { name: 'B', rows: [['y'], [2]] },
    ]);
    const result = await run(file, { sheet: 'all' });
    expect('A' in result.sheets).toBe(true);
    expect('B' in result.sheets).toBe(true);
  });

  it('exports single sheet by name', async () => {
    const file = makeMultiSheetXlsxFile([
      { name: 'Sales', rows: [['product', 'qty'], ['Widget', 5]] },
      { name: 'Returns', rows: [['product', 'qty'], ['Widget', 1]] },
    ]);
    const result = await run(file, { sheet: 'Sales' });
    expect('Sales' in result.sheets).toBe(true);
    expect('Returns' in result.sheets).toBe(false);
  });

  it('throws on missing sheet', async () => {
    const file = makeXlsxFile(ROWS);
    await expect(run(file, { sheet: 'Ghost' })).rejects.toThrow(/not found/);
  });

  it('uses array of arrays when arrayStyle=arrays', async () => {
    const file = makeXlsxFile(ROWS);
    const result = await run(file, { arrayStyle: 'arrays' });
    const rows = result.sheets['Sheet1']!;
    expect(Array.isArray(rows[0])).toBe(true);
    expect((rows[0] as unknown[])[0]).toBe('name');
  });

  it('strips header row from arrays when includeHeaders=false', async () => {
    const file = makeXlsxFile(ROWS);
    const result = await run(file, { arrayStyle: 'arrays', includeHeaders: false });
    const rows = result.sheets['Sheet1']!;
    // first row should be data, not headers
    expect((rows[0] as unknown[])[0]).toBe('Alice');
  });

  it('output is valid JSON blob', async () => {
    const file = makeXlsxFile(ROWS);
    const result = await excelToJson.run([file], {}, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/json');
    const text = await blob.text();
    expect(() => { JSON.parse(text); }).not.toThrow();
  });
});
