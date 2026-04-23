/**
 * Shared test helpers for Excel tool tests.
 * Builds minimal XLSX buffers using SheetJS — works in Node without browser APIs.
 */
import * as XLSX from 'xlsx';
import type { ToolRunContext } from '../../src/types.js';

export function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

/** Build an XLSX File with one sheet containing the given rows (array of arrays). */
export function makeXlsxFile(
  rows: unknown[][],
  sheetName = 'Sheet1',
  fileName = 'test.xlsx',
): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf: Uint8Array = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
  return new File([buf], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Build an XLSX File with multiple sheets. */
export function makeMultiSheetXlsxFile(
  sheets: { name: string; rows: unknown[][] }[],
  fileName = 'test.xlsx',
): File {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const buf: Uint8Array = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
  return new File([buf], fileName, {
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
