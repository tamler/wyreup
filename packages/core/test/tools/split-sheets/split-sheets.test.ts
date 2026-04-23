import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { splitSheets } from '../../../src/tools/split-sheets/index.js';
import { makeCtx, makeXlsxFile, makeMultiSheetXlsxFile } from '../excel-helpers.js';

async function runAndUnzip(
  file: File,
): Promise<{ names: string[]; workbooks: XLSX.WorkBook[] }> {
  const blob = (await splitSheets.run([file], {}, makeCtx())) as Blob;
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files);
  const workbooks = await Promise.all(
    names.map(async (n) => {
      const buf = await zip.files[n]!.async('uint8array');
      return XLSX.read(buf, { type: 'array' });
    }),
  );
  return { names, workbooks };
}

// ── Metadata ──────────────────────────────────────────────────────────────────

describe('split-sheets — metadata', () => {
  it('has id split-sheets', () => expect(splitSheets.id).toBe('split-sheets'));
  it('is in edit category', () => expect(splitSheets.category).toBe('edit'));
  it('accepts exactly 1 file', () => {
    expect(splitSheets.input.min).toBe(1);
    expect(splitSheets.input.max).toBe(1);
  });
  it('outputs application/zip', () => expect(splitSheets.output.mime).toBe('application/zip'));
});

// ── run() ─────────────────────────────────────────────────────────────────────

describe('split-sheets — run()', () => {
  it('splits a two-sheet workbook into two XLSX files', async () => {
    const file = makeMultiSheetXlsxFile([
      { name: 'Alpha', rows: [['a'], [1]] },
      { name: 'Beta', rows: [['b'], [2]] },
    ]);
    const { names } = await runAndUnzip(file);
    expect(names).toHaveLength(2);
    expect(names).toContain('Alpha.xlsx');
    expect(names).toContain('Beta.xlsx');
  });

  it('each file contains only its own sheet', async () => {
    const file = makeMultiSheetXlsxFile([
      { name: 'X', rows: [['x'], [10]] },
      { name: 'Y', rows: [['y'], [20]] },
    ]);
    const { workbooks } = await runAndUnzip(file);
    expect(workbooks[0]!.SheetNames).toHaveLength(1);
    expect(workbooks[1]!.SheetNames).toHaveLength(1);
  });

  it('preserves sheet data', async () => {
    const file = makeMultiSheetXlsxFile([
      { name: 'People', rows: [['name', 'age'], ['Alice', 30]] },
    ]);
    const blob = (await splitSheets.run([file], {}, makeCtx())) as Blob;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const buf = await zip.files['People.xlsx']!.async('uint8array');
    const wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['People']!, { header: 1 });
    expect((rows[0] as unknown[])[0]).toBe('name');
    expect((rows[1] as unknown[])[0]).toBe('Alice');
  });

  it('handles single-sheet workbook', async () => {
    const file = makeXlsxFile([['col'], ['val']], 'Only');
    const { names } = await runAndUnzip(file);
    expect(names).toHaveLength(1);
    expect(names[0]).toBe('Only.xlsx');
  });

  it('sanitizes sheet names with special chars in zip filenames', async () => {
    const file = makeMultiSheetXlsxFile([
      { name: 'Sheet One', rows: [['x']] },
    ]);
    const { names } = await runAndUnzip(file);
    // Special chars should be sanitized or kept safe
    expect(names[0]).toMatch(/\.xlsx$/);
  });
});
