import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { csvToExcel } from '../../../src/tools/csv-to-excel/index.js';
import { makeCtx, makeCsvFile } from '../excel-helpers.js';

const SAMPLE_CSV = 'name,age,city\nAlice,30,NY\nBob,25,LA';
const SAMPLE_CSV_SEMI = 'name;age;city\nAlice;30;NY';
const SAMPLE_CSV_TAB = 'name\tage\tcity\nAlice\t30\tNY';

function readXlsx(blob: Blob): Promise<XLSX.WorkBook> {
  return blob.arrayBuffer().then((buf) =>
    XLSX.read(new Uint8Array(buf), { type: 'array' }),
  );
}

// ── Metadata ──────────────────────────────────────────────────────────────────

describe('csv-to-excel — metadata', () => {
  it('has id csv-to-excel', () => expect(csvToExcel.id).toBe('csv-to-excel'));
  it('is in convert category', () => expect(csvToExcel.category).toBe('convert'));
  it('accepts text/csv', () => expect(csvToExcel.input.accept).toContain('text/csv'));
  it('accepts up to 10 files', () => expect(csvToExcel.input.max).toBe(10));
  it('outputs xlsx mime', () => {
    expect(csvToExcel.output.mime).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });
  it('has paramSchema', () => expect(csvToExcel.paramSchema).toBeDefined());
});

// ── run() ─────────────────────────────────────────────────────────────────────

describe('csv-to-excel — run()', () => {
  it('converts a single CSV to a workbook with one sheet', async () => {
    const file = makeCsvFile(SAMPLE_CSV, 'sales.csv');
    const blob = (await csvToExcel.run([file], {}, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    expect(wb.SheetNames).toHaveLength(1);
    expect(wb.SheetNames[0]).toBe('sales');
  });

  it('sheet data matches CSV content', async () => {
    const file = makeCsvFile(SAMPLE_CSV, 'data.csv');
    const blob = (await csvToExcel.run([file], {}, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['data']!, { header: 1 });
    expect((rows[0] as unknown[])[0]).toBe('name');
    expect((rows[1] as unknown[])[0]).toBe('Alice');
  });

  it('auto-detects semicolon delimiter', async () => {
    const file = makeCsvFile(SAMPLE_CSV_SEMI, 'semi.csv');
    const blob = (await csvToExcel.run([file], { delimiter: 'auto' }, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['semi']!, { header: 1 });
    expect((rows[0] as unknown[])[1]).toBe('age');
  });

  it('auto-detects tab delimiter', async () => {
    const file = makeCsvFile(SAMPLE_CSV_TAB, 'tab.csv');
    const blob = (await csvToExcel.run([file], { delimiter: 'auto' }, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['tab']!, { header: 1 });
    expect((rows[0] as unknown[])[0]).toBe('name');
    expect((rows[0] as unknown[])[1]).toBe('age');
  });

  it('combines multiple CSVs into one workbook', async () => {
    const f1 = makeCsvFile('a,b\n1,2', 'sheet1.csv');
    const f2 = makeCsvFile('c,d\n3,4', 'sheet2.csv');
    const blob = (await csvToExcel.run([f1, f2], {}, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    expect(wb.SheetNames).toHaveLength(2);
    expect(wb.SheetNames).toContain('sheet1');
    expect(wb.SheetNames).toContain('sheet2');
  });

  it('uses generic sheet names when sheetNameFromFilename=false', async () => {
    const f1 = makeCsvFile('a,b\n1,2', 'data.csv');
    const f2 = makeCsvFile('c,d\n3,4', 'other.csv');
    const blob = (await csvToExcel.run([f1, f2], { sheetNameFromFilename: false }, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    expect(wb.SheetNames[0]).toBe('Sheet1');
    expect(wb.SheetNames[1]).toBe('Sheet2');
  });

  it('deduplicates sheet names from identical filenames', async () => {
    const f1 = makeCsvFile('a\n1', 'data.csv');
    const f2 = makeCsvFile('b\n2', 'data.csv');
    const blob = (await csvToExcel.run([f1, f2], {}, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    expect(wb.SheetNames).toHaveLength(2);
    expect(wb.SheetNames[0]).not.toBe(wb.SheetNames[1]);
  });

  it('output is a valid XLSX buffer', async () => {
    const file = makeCsvFile(SAMPLE_CSV);
    const blob = (await csvToExcel.run([file], {}, makeCtx())) as Blob;
    expect(blob.size).toBeGreaterThan(0);
    // PK header magic bytes indicate ZIP/XLSX
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
  });
});
