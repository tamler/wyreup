/**
 * Shared test helpers for Excel tool tests. Builds minimal XLSX buffers
 * using ExcelJS (migrated from SheetJS — see packages/core/src/lib/excel.ts
 * for the migration story).
 */
import ExcelJS from 'exceljs';
import type { ToolRunContext } from '../../src/types.js';

export function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function writeWorkbookToBuffer(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  const out = await wb.xlsx.writeBuffer();
  if (out instanceof Uint8Array) return out;
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  return new Uint8Array(out);
}

/** Build an XLSX File with one sheet containing the given rows (array of arrays). */
export async function makeXlsxFile(
  rows: unknown[][],
  sheetName = 'Sheet1',
  fileName = 'test.xlsx',
): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const row of rows) ws.addRow(row);
  const buf = await writeWorkbookToBuffer(wb);
  return new File([buf as BlobPart], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Build an XLSX File with multiple sheets. */
export async function makeMultiSheetXlsxFile(
  sheets: { name: string; rows: unknown[][] }[],
  fileName = 'test.xlsx',
): Promise<File> {
  const wb = new ExcelJS.Workbook();
  for (const { name, rows } of sheets) {
    const ws = wb.addWorksheet(name);
    for (const row of rows) ws.addRow(row);
  }
  const buf = await writeWorkbookToBuffer(wb);
  return new File([buf as BlobPart], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function makeCsvFile(content: string, name = 'data.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

export function makeJsonFile(content: unknown, name = 'data.json'): File {
  return new File([JSON.stringify(content)], name, { type: 'application/json' });
}

export function makeHtmlFile(content: string, name = 'page.html'): File {
  return new File([content], name, { type: 'text/html' });
}
