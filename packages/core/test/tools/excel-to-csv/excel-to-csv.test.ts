import { describe, it, expect } from 'vitest';
import { excelToCsv } from '../../../src/tools/excel-to-csv/index.js';
import { makeCtx, makeXlsxFile, makeMultiSheetXlsxFile } from '../excel-helpers.js';

const ROWS = [
  ['name', 'age', 'city'],
  ['Alice', 30, 'NY'],
  ['Bob', 25, 'LA'],
];

async function run(file: File, params = {}): Promise<string> {
  const result = await excelToCsv.run([file], params, makeCtx());
  const blob = Array.isArray(result) ? result[0]! : result;
  return blob.text();
}

// ── Metadata ──────────────────────────────────────────────────────────────────

describe('excel-to-csv — metadata', () => {
  it('has id excel-to-csv', () => expect(excelToCsv.id).toBe('excel-to-csv'));
  it('is in the convert category', () => expect(excelToCsv.category).toBe('convert'));
  it('accepts xlsx mime', () => {
    expect(excelToCsv.input.accept).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });
  it('has defaults', () => {
    expect(excelToCsv.defaults.delimiter).toBe(',');
    expect(excelToCsv.defaults.includeHeaders).toBe(true);
  });
  it('has paramSchema', () => expect(excelToCsv.paramSchema).toBeDefined());
});

// ── run() ─────────────────────────────────────────────────────────────────────

describe('excel-to-csv — run()', () => {
  it('converts first sheet to CSV by default', async () => {
    const file = makeXlsxFile(ROWS);
    const csv = await run(file);
    expect(csv).toContain('name,age,city');
    expect(csv).toContain('Alice,30,NY');
    expect(csv).toContain('Bob,25,LA');
  });

  it('uses semicolon delimiter', async () => {
    const file = makeXlsxFile(ROWS);
    const csv = await run(file, { delimiter: ';' });
    expect(csv).toContain('name;age;city');
    expect(csv).toContain('Alice;30;NY');
  });

  it('uses tab delimiter', async () => {
    const file = makeXlsxFile(ROWS);
    const csv = await run(file, { delimiter: '\t' });
    expect(csv).toContain('name\tage\tcity');
  });

  it('strips header row when includeHeaders=false', async () => {
    const file = makeXlsxFile(ROWS);
    const csv = await run(file, { includeHeaders: false });
    expect(csv).not.toContain('name,age');
    expect(csv).toContain('Alice');
  });

  it('exports specific sheet by name', async () => {
    const file = makeMultiSheetXlsxFile([
      { name: 'Sales', rows: [['product', 'qty'], ['Widget', 10]] },
      { name: 'Costs', rows: [['item', 'cost'], ['Rent', 500]] },
    ]);
    const csv = await run(file, { sheet: 'Costs' });
    expect(csv).toContain('item,cost');
    expect(csv).toContain('Rent,500');
    expect(csv).not.toContain('product');
  });

  it('throws on non-existent sheet name', async () => {
    const file = makeXlsxFile(ROWS);
    await expect(run(file, { sheet: 'NoSuchSheet' })).rejects.toThrow(/not found/);
  });

  it('exports all sheets as ZIP when sheet=all', async () => {
    const file = makeMultiSheetXlsxFile([
      { name: 'Alpha', rows: [['a'], [1]] },
      { name: 'Beta', rows: [['b'], [2]] },
    ]);
    const result = await excelToCsv.run([file], { sheet: 'all' }, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('returns text/csv for single sheet', async () => {
    const file = makeXlsxFile(ROWS);
    const result = await excelToCsv.run([file], {}, makeCtx());
    const blob = Array.isArray(result) ? result[0]! : result;
    expect(blob.type).toBe('text/csv');
  });

  it('handles empty sheet gracefully', async () => {
    const file = makeXlsxFile([]);
    const csv = await run(file);
    // empty sheet returns empty or minimal CSV
    expect(typeof csv).toBe('string');
  });
});
