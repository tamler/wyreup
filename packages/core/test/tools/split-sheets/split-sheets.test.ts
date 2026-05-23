import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { splitSheets } from '../../../src/tools/split-sheets/index.js';
import {
  readWorkbook,
  sheetNames,
  getSheet,
  sheetToAOA,
} from '../../../src/lib/excel.js';
import { makeCtx, makeXlsxFile, makeMultiSheetXlsxFile } from '../excel-helpers.js';

async function runAndUnzip(
  file: File,
): Promise<{ names: string[]; perFileSheetNames: string[][] }> {
  const blob = (await splitSheets.run([file], {}, makeCtx())) as Blob;
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const names = Object.keys(zip.files);
  const perFileSheetNames = await Promise.all(
    names.map(async (n) => {
      const buf = await zip.files[n]!.async('uint8array');
      const wb = await readWorkbook(buf);
      return sheetNames(wb);
    }),
  );
  return { names, perFileSheetNames };
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
    const file = await makeMultiSheetXlsxFile([
      { name: 'Alpha', rows: [['a'], [1]] },
      { name: 'Beta', rows: [['b'], [2]] },
    ]);
    const { names } = await runAndUnzip(file);
    expect(names).toHaveLength(2);
    expect(names).toContain('Alpha.xlsx');
    expect(names).toContain('Beta.xlsx');
  });

  it('each file contains only its own sheet', async () => {
    const file = await makeMultiSheetXlsxFile([
      { name: 'X', rows: [['x'], [10]] },
      { name: 'Y', rows: [['y'], [20]] },
    ]);
    const { perFileSheetNames } = await runAndUnzip(file);
    expect(perFileSheetNames[0]).toHaveLength(1);
    expect(perFileSheetNames[1]).toHaveLength(1);
  });

  it('preserves sheet data', async () => {
    const file = await makeMultiSheetXlsxFile([
      { name: 'People', rows: [['name', 'age'], ['Alice', 30]] },
    ]);
    const blob = (await splitSheets.run([file], {}, makeCtx())) as Blob;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const buf = await zip.files['People.xlsx']!.async('uint8array');
    const wb = await readWorkbook(buf);
    const ws = getSheet(wb, 'People');
    expect(ws).toBeDefined();
    const rows = sheetToAOA(ws!);
    expect(rows[0]![0]).toBe('name');
    expect(rows[1]![0]).toBe('Alice');
  });

  it('handles single-sheet workbook', async () => {
    const file = await makeXlsxFile([['col'], ['val']], 'Only');
    const { names } = await runAndUnzip(file);
    expect(names).toHaveLength(1);
    expect(names[0]).toBe('Only.xlsx');
  });

  it('sanitizes sheet names with special chars in zip filenames', async () => {
    const file = await makeMultiSheetXlsxFile([
      { name: 'Sheet One', rows: [['x']] },
    ]);
    const { names } = await runAndUnzip(file);
    expect(names[0]).toMatch(/\.xlsx$/);
  });
});
