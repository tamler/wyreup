import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { jsonToExcel } from '../../../src/tools/json-to-excel/index.js';
import { makeCtx, makeJsonFile } from '../excel-helpers.js';

const OBJECTS = [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }];
const ARRAYS = [['name', 'age'], ['Alice', 30], ['Bob', 25]];
const MULTI = {
  sheets: {
    Sales: [{ product: 'Widget', qty: 10 }],
    Returns: [{ product: 'Widget', qty: 1 }],
  },
};

function readXlsx(blob: Blob): Promise<XLSX.WorkBook> {
  return blob.arrayBuffer().then((buf) => XLSX.read(new Uint8Array(buf), { type: 'array' }));
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
    const wb = await readXlsx(blob);
    expect(wb.SheetNames).toHaveLength(1);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Sheet1']!);
    expect(rows[0]!['name']).toBe('Alice');
    expect(rows[1]!['age']).toBe(25);
  });

  it('uses sheetName param', async () => {
    const file = makeJsonFile(OBJECTS);
    const blob = (await jsonToExcel.run([file], { sheetName: 'People' }, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    expect(wb.SheetNames[0]).toBe('People');
  });

  it('converts array of arrays to xlsx', async () => {
    const file = makeJsonFile(ARRAYS);
    const blob = (await jsonToExcel.run([file], {}, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Sheet1']!, { header: 1 });
    expect((rows[0] as unknown[])[0]).toBe('name');
    expect((rows[1] as unknown[])[0]).toBe('Alice');
  });

  it('converts multi-sheet {sheets: ...} format', async () => {
    const file = makeJsonFile(MULTI);
    const blob = (await jsonToExcel.run([file], {}, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    expect(wb.SheetNames).toContain('Sales');
    expect(wb.SheetNames).toContain('Returns');
    const salesRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Sales']!);
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
