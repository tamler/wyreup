import { describe, it, expect } from 'vitest';
import { jsonToExcel } from '../../../src/tools/json-to-excel/index.js';
import {
  readWorkbook,
  sheetNames,
  getSheet,
  sheetToAOA,
  sheetToObjects,
} from '../../../src/lib/excel.js';
import { makeCtx, makeJsonFile } from '../excel-helpers.js';

const OBJECTS = [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }];
const ARRAYS = [['name', 'age'], ['Alice', 30], ['Bob', 25]];
const MULTI = {
  sheets: {
    Sales: [{ product: 'Widget', qty: 10 }],
    Returns: [{ product: 'Widget', qty: 1 }],
  },
};

async function loadXlsx(blob: Blob) {
  return readWorkbook(new Uint8Array(await blob.arrayBuffer()));
}

// ── Metadata ──────────────────────────────────────────────────────────────────

describe('json-to-excel — metadata', () => {
  it('has id json-to-excel', () => expect(jsonToExcel.id).toBe('json-to-excel'));
  it('is in convert category', () => expect(jsonToExcel.category).toBe('convert'));
  it('accepts application/json', () => expect(jsonToExcel.input.accept).toContain('application/json'));
  it('has paramSchema', () => expect(jsonToExcel.paramSchema).toBeDefined());
});

// ── run() ─────────────────────────────────────────────────────────────────────

describe('json-to-excel — run()', () => {
  it('converts array of objects to xlsx', async () => {
    const file = makeJsonFile(OBJECTS);
    const blob = (await jsonToExcel.run([file], {}, makeCtx())) as Blob;
    const wb = await loadXlsx(blob);
    expect(sheetNames(wb)).toHaveLength(1);
    const ws = getSheet(wb, 'Sheet1');
    const rows = sheetToObjects(ws!);
    expect(rows[0]!['name']).toBe('Alice');
    // ExcelJS reads numeric cells as numbers — assert as number.
    expect(rows[1]!['age']).toBe(25);
  });

  it('uses sheetName param', async () => {
    const file = makeJsonFile(OBJECTS);
    const blob = (await jsonToExcel.run([file], { sheetName: 'People' }, makeCtx())) as Blob;
    const wb = await loadXlsx(blob);
    expect(sheetNames(wb)[0]).toBe('People');
  });

  it('converts array of arrays to xlsx', async () => {
    const file = makeJsonFile(ARRAYS);
    const blob = (await jsonToExcel.run([file], {}, makeCtx())) as Blob;
    const wb = await loadXlsx(blob);
    const ws = getSheet(wb, 'Sheet1');
    const rows = sheetToAOA(ws!);
    expect(rows[0]![0]).toBe('name');
    expect(rows[1]![0]).toBe('Alice');
  });

  it('converts multi-sheet {sheets: ...} format', async () => {
    const file = makeJsonFile(MULTI);
    const blob = (await jsonToExcel.run([file], {}, makeCtx())) as Blob;
    const wb = await loadXlsx(blob);
    const names = sheetNames(wb);
    expect(names).toContain('Sales');
    expect(names).toContain('Returns');
    const salesRows = sheetToObjects(getSheet(wb, 'Sales')!);
    expect(salesRows[0]!['product']).toBe('Widget');
  });

  it('throws on invalid JSON', async () => {
    const file = new File(['not json'], 'bad.json', { type: 'application/json' });
    await expect(jsonToExcel.run([file], {}, makeCtx())).rejects.toThrow(/Invalid JSON/);
  });

  it('throws on non-array non-object JSON', async () => {
    const file = makeJsonFile('hello world');
    await expect(jsonToExcel.run([file], {}, makeCtx())).rejects.toThrow();
  });

  it('output has valid XLSX header bytes', async () => {
    const file = makeJsonFile(OBJECTS);
    const blob = (await jsonToExcel.run([file], {}, makeCtx())) as Blob;
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
  });
});
