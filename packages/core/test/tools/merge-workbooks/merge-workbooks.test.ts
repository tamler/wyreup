import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { mergeWorkbooks } from '../../../src/tools/merge-workbooks/index.js';
import { makeCtx, makeXlsxFile, makeMultiSheetXlsxFile } from '../excel-helpers.js';

function readXlsx(blob: Blob): Promise<XLSX.WorkBook> {
  return blob.arrayBuffer().then((buf) => XLSX.read(new Uint8Array(buf), { type: 'array' }));
}

// ── Metadata ──────────────────────────────────────────────────────────────────

describe('merge-workbooks — metadata', () => {
  it('has id merge-workbooks', () => expect(mergeWorkbooks.id).toBe('merge-workbooks'));
  it('is in edit category', () => expect(mergeWorkbooks.category).toBe('edit'));
  it('requires at least 2 files', () => expect(mergeWorkbooks.input.min).toBe(2));
  it('accepts up to 20 files', () => expect(mergeWorkbooks.input.max).toBe(20));
  it('has paramSchema', () => expect(mergeWorkbooks.paramSchema).toBeDefined());
});

// ── run() ─────────────────────────────────────────────────────────────────────

describe('merge-workbooks — run()', () => {
  it('merges two single-sheet workbooks', async () => {
    const f1 = makeXlsxFile([['a'], [1]], 'Sheet1', 'wb1.xlsx');
    const f2 = makeXlsxFile([['b'], [2]], 'Sheet1', 'wb2.xlsx');
    const blob = (await mergeWorkbooks.run([f1, f2], {}, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    expect(wb.SheetNames).toHaveLength(2);
  });

  it('prefixes sheet names with source filename by default', async () => {
    const f1 = makeXlsxFile([['a']], 'Sheet1', 'alpha.xlsx');
    const f2 = makeXlsxFile([['b']], 'Sheet1', 'beta.xlsx');
    const blob = (await mergeWorkbooks.run([f1, f2], { prefixSheetNames: true }, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    expect(wb.SheetNames.some((n) => n.startsWith('alpha'))).toBe(true);
    expect(wb.SheetNames.some((n) => n.startsWith('beta'))).toBe(true);
  });

  it('does not prefix when prefixSheetNames=false', async () => {
    const f1 = makeXlsxFile([['a']], 'MySheet', 'alpha.xlsx');
    const f2 = makeXlsxFile([['b']], 'OtherSheet', 'beta.xlsx');
    const blob = (await mergeWorkbooks.run([f1, f2], { prefixSheetNames: false }, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    expect(wb.SheetNames).toContain('MySheet');
    expect(wb.SheetNames).toContain('OtherSheet');
  });

  it('merges multi-sheet workbooks', async () => {
    const f1 = makeMultiSheetXlsxFile([
      { name: 'A', rows: [['x']] },
      { name: 'B', rows: [['y']] },
    ], 'wb1.xlsx');
    const f2 = makeXlsxFile([['z']], 'C', 'wb2.xlsx');
    const blob = (await mergeWorkbooks.run([f1, f2], { prefixSheetNames: false }, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    expect(wb.SheetNames).toHaveLength(3);
  });

  it('deduplicates colliding sheet names', async () => {
    const f1 = makeXlsxFile([['a']], 'Sheet1', 'wb1.xlsx');
    const f2 = makeXlsxFile([['b']], 'Sheet1', 'wb2.xlsx');
    const blob = (await mergeWorkbooks.run([f1, f2], { prefixSheetNames: false }, makeCtx())) as Blob;
    const wb = await readXlsx(blob);
    expect(wb.SheetNames).toHaveLength(2);
    expect(new Set(wb.SheetNames).size).toBe(2);
  });

  it('output is valid XLSX', async () => {
    const f1 = makeXlsxFile([['a']], 'S1', 'f1.xlsx');
    const f2 = makeXlsxFile([['b']], 'S2', 'f2.xlsx');
    const blob = (await mergeWorkbooks.run([f1, f2], {}, makeCtx())) as Blob;
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});
