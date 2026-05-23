// Shared helpers for tools that read or write XLSX files via ExcelJS.
//
// We migrated off SheetJS (`xlsx@0.18.5`) in 2026-05 because the public
// npm package is abandoned with unfixed Prototype Pollution + ReDoS
// advisories — the maintainer moved to a paid distribution. ExcelJS is
// active, MIT-licensed, and battle-tested. The API is different though,
// so these helpers reproduce the few SheetJS conveniences we relied on
// (aoa_to_sheet, json_to_sheet, sheet_to_csv, sheet_to_json) on top of
// ExcelJS's lower-level Row/Cell model.
//
// Everything here is lazy: `loadExcelJs()` only imports the lib on
// first use, so tools that never read xlsx don't pay the bundle cost.

import type * as ExcelJsType from 'exceljs';
import type { Workbook, Worksheet, Row, CellValue } from 'exceljs';

type ExcelJsModule = typeof ExcelJsType;

let ExcelJsPromise: Promise<ExcelJsModule> | null = null;

async function loadExcelJs(): Promise<ExcelJsModule> {
  if (!ExcelJsPromise) {
    // ExcelJS doesn't expose a default ESM export consistently across
    // build targets — sometimes it's the module, sometimes it's
    // module.default. Normalize here so callers can do `new
    // ExcelJS.Workbook()` without thinking.
    ExcelJsPromise = import('exceljs').then((m) => {
      const mod = (m as { default?: ExcelJsModule }).default ?? m;
      return mod;
    });
  }
  return ExcelJsPromise;
}

/** Construct a new empty workbook. */
export async function newWorkbook(): Promise<Workbook> {
  const ExcelJS = await loadExcelJs();
  return new ExcelJS.Workbook();
}

/** Parse an XLSX file (bytes or ArrayBuffer) into a workbook. */
export async function readWorkbook(bytes: Uint8Array | ArrayBuffer): Promise<Workbook> {
  const wb = await newWorkbook();
  // ExcelJS's xlsx.load wants an ArrayBuffer; accept either form.
  const buf =
    bytes instanceof Uint8Array
      ? (bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer)
      : bytes;
  await wb.xlsx.load(buf);
  return wb;
}

/** Serialize a workbook to XLSX bytes. */
export async function writeWorkbookBuffer(wb: Workbook): Promise<ArrayBuffer> {
  // ExcelJS returns a Node Buffer or ArrayBuffer depending on env;
  // both have .byteLength and slice into a fresh ArrayBuffer cleanly.
  const out = await wb.xlsx.writeBuffer();
  if (out instanceof ArrayBuffer) return out;
  // Node Buffer / Uint8Array view path
  const view = out as unknown as Uint8Array;
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
}

/** Names of every worksheet in the workbook, in order. */
export function sheetNames(wb: Workbook): string[] {
  return wb.worksheets.map((ws) => ws.name);
}

/** Get a worksheet by name. Returns undefined if absent. */
export function getSheet(wb: Workbook, name: string): Worksheet | undefined {
  return wb.getWorksheet(name);
}

/**
 * Read a worksheet as an array-of-arrays. Header row (if present) is
 * the first array. ExcelJS rows are 1-indexed; we drop the leading
 * undefined that `row.values` includes.
 */
export function sheetToAOA(ws: Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row: Row) => {
    const v = row.values;
    const arr = Array.isArray(v) ? v.slice(1) : [];
    rows.push(arr.map(coerceCellValue));
  });
  return rows;
}

/**
 * Read a worksheet as an array-of-objects, using the first row as
 * headers. Mirrors SheetJS's `sheet_to_json` default behavior.
 * Missing cells become null.
 */
export function sheetToObjects(ws: Worksheet): Record<string, unknown>[] {
  const aoa = sheetToAOA(ws);
  if (aoa.length === 0) return [];
  const headers = (aoa[0] ?? []).map((h, i) => {
    const s = typeof h === 'string' ? h : h == null ? '' : String(h as number | boolean);
    return s || `Column${i + 1}`;
  });
  return aoa.slice(1).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? null;
    });
    return obj;
  });
}

/**
 * Render a worksheet as a CSV string with the given field separator.
 * Mirrors SheetJS's `sheet_to_csv({ FS })` — quoting matches RFC 4180.
 * Blank rows are dropped (the SheetJS default behavior `blankrows:
 * false` we used everywhere).
 */
export function sheetToCsv(ws: Worksheet, delimiter: string = ','): string {
  const aoa = sheetToAOA(ws);
  const lines = aoa
    .filter((row) => row.length > 0 && row.some((c) => c !== null && c !== '' && c !== undefined))
    .map((row) => row.map((c) => escapeCsvField(c, delimiter)).join(delimiter));
  return lines.join('\n');
}

/**
 * Append an array-of-arrays as rows on the given worksheet. The first
 * sub-array becomes the header row by convention.
 */
export function addAOAToSheet(ws: Worksheet, rows: unknown[][]): void {
  for (const row of rows) {
    ws.addRow(row);
  }
}

/**
 * Append an array-of-objects as rows on the given worksheet. Headers
 * are inferred from the union of every object's keys, preserving
 * insertion order. Missing keys become null cells.
 */
export function addObjectsToSheet(ws: Worksheet, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  ws.addRow(headers as CellValue[]);
  for (const row of rows) {
    ws.addRow(headers.map((h) => (row[h] ?? null) as CellValue));
  }
}

/**
 * Workbook-level helper: add a new worksheet by name. Mirrors
 * SheetJS's `book_append_sheet` shape — we hand back the worksheet
 * so callers can populate it.
 */
export function addWorksheet(wb: Workbook, name: string): Worksheet {
  return wb.addWorksheet(name);
}

// ────────────────────────────────────────────────────────────────────
// internals

/**
 * ExcelJS exposes cells as primitives most of the time, but formulas,
 * hyperlinks, rich text, and dates each have their own object shape.
 * Normalize to a primitive (or null) so downstream consumers don't
 * have to know the difference.
 */
function coerceCellValue(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v !== 'object') return v;
  // Date — ExcelJS gives us a JS Date object for date cells.
  if (v instanceof Date) return v.toISOString();
  const obj = v as Record<string, unknown>;
  // Formula cells: { formula, result, ... }
  if ('result' in obj) return obj['result'] ?? null;
  // Hyperlink cells: { text, hyperlink }
  if ('text' in obj && typeof obj['text'] === 'string') return obj['text'];
  // Rich text: { richText: [{ text, font? }, ...] }
  if ('richText' in obj && Array.isArray(obj['richText'])) {
    return (obj['richText'] as { text?: unknown }[])
      .map((seg) => (typeof seg.text === 'string' ? seg.text : ''))
      .join('');
  }
  // Error cells: { error: '#REF!' }
  if ('error' in obj) return String(obj['error']);
  // Unknown shape — stringify so we at least don't return `[object Object]`.
  return JSON.stringify(obj);
}

function escapeCsvField(value: unknown, delimiter: string): string {
  if (value == null) return '';
  // After coerceCellValue() upstream, value is a primitive — but
  // TypeScript doesn't track that, so narrow defensively here.
  const s =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
        ? String(value)
        : JSON.stringify(value);
  if (s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
