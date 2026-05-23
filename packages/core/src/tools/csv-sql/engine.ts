// SQLite-WASM engine wrapper for csv-sql.
//
// Loads @sqlite.org/sqlite-wasm lazily on first use (~700 KB WASM), then
// turns each input File into a SQLite table named after the filename.
// Runs the user's SQL and returns a normalized result. Everything is
// in-memory per call — no persistence, no shared state across runs.
//
// Supported input formats:
//   - text/csv, text/plain (TSV inferred from delimiter), or any
//     text with a CSV-ish header parsed by papaparse
//   - application/json — array of objects (one row per object)
//   - .xlsx — first sheet, parsed by xlsx

import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  /** Empty array when the query was DDL/DML with no result set. */
  rowCount: number;
}

export interface FileToLoad {
  /** Display filename — used to derive the table name. */
  name: string;
  /** Raw bytes of the file. */
  bytes: Uint8Array;
  /** MIME type from the File / Blob, used to pick a parser. */
  mime: string;
}

// Cache the initialized sqlite3 module across calls in the same session
// so we don't pay the ~700 KB WASM load on every run.
let sqlite3Promise: Promise<Sqlite3Static> | null = null;

async function getSqlite(): Promise<Sqlite3Static> {
  if (!sqlite3Promise) {
    sqlite3Promise = (async () => {
      const mod = await import('@sqlite.org/sqlite-wasm');
      // Default export is the init function; awaiting it returns the
      // sqlite3 namespace with oo1.DB on it.
      return mod.default();
    })();
  }
  return sqlite3Promise;
}

/**
 * Sanitize a filename into a safe SQL identifier. "Customers (2025).csv"
 * → "customers_2025". Leading digits and reserved words get a `t_` prefix.
 */
export function tableNameFor(filename: string): string {
  const base = filename
    .replace(/\.[^./\\]+$/, '') // drop extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!base) return 't_data';
  return /^[a-z]/.test(base) ? base : `t_${base}`;
}

/**
 * Parse one input file into header + rows. Format is picked from the
 * filename and the MIME type — if neither is conclusive, we treat the
 * file as CSV.
 */
async function parseFile(file: FileToLoad): Promise<{ headers: string[]; rows: unknown[][] }> {
  const lowerName = file.name.toLowerCase();
  const isJson = file.mime === 'application/json' || lowerName.endsWith('.json');
  const isXlsx =
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.xls') ||
    file.mime ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.mime === 'application/vnd.ms-excel';

  if (isJson) {
    const text = new TextDecoder().decode(file.bytes);
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`${file.name}: JSON input must be an array of objects.`);
    }
    if (parsed.length === 0) {
      return { headers: [], rows: [] };
    }
    const headers = [
      ...new Set(parsed.flatMap((row) => Object.keys(row as Record<string, unknown>))),
    ];
    const rows = parsed.map((row) => {
      const obj = row as Record<string, unknown>;
      return headers.map((h) => obj[h] ?? null);
    });
    return { headers, rows };
  }

  if (isXlsx) {
    const { readWorkbook, sheetToObjects } = await import('../../lib/excel.js');
    const wb = await readWorkbook(file.bytes);
    const firstWs = wb.worksheets[0];
    if (!firstWs) {
      throw new Error(`${file.name}: workbook has no sheets.`);
    }
    const rowsArr = sheetToObjects(firstWs);
    if (rowsArr.length === 0) {
      return { headers: [], rows: [] };
    }
    const headers = [...new Set(rowsArr.flatMap((r) => Object.keys(r)))];
    const rows = rowsArr.map((r) => headers.map((h) => r[h] ?? null));
    return { headers, rows };
  }

  // Default: CSV / TSV via papaparse with auto-delimiter detection.
  const Papa = (await import('papaparse')).default;
  const text = new TextDecoder().decode(file.bytes);
  const parsed = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
  });
  const all = parsed.data;
  if (all.length === 0) {
    throw new Error(`${file.name}: CSV is empty.`);
  }
  const headers = (all[0] ?? []).map((h, i) => h?.trim() || `col_${i + 1}`);
  const rows = all.slice(1).map((row) => headers.map((_, i) => row[i] ?? null));
  return { headers, rows };
}

/** Map any value to one SQLite accepts. Objects/arrays are JSON-stringified. */
function toSqlBindable(v: unknown): string | number | bigint | null | Uint8Array {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'bigint') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  // Objects, arrays, dates → JSON string. The user can json_extract().
  return JSON.stringify(v);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Load files into a fresh in-memory SQLite DB and run the user's query.
 * Each file becomes one table; the table name is derived from the
 * filename. If two files would collapse to the same table name, the
 * second one gets a numeric suffix.
 */
export async function runQuery(
  files: FileToLoad[],
  sql: string,
): Promise<QueryResult> {
  if (files.length === 0) throw new Error('Provide at least one input file.');
  if (!sql.trim()) throw new Error('Provide a SQL query.');

  const sqlite3 = await getSqlite();
  // Constructor positional form: filename, flags. ':memory:' = in-process,
  // never touches disk or OPFS. Flags 'c' = create. Omit 't' (SQL
  // tracing) because it spams console.log on every statement.
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  const usedNames = new Set<string>();
  try {
    for (const file of files) {
      const { headers, rows } = await parseFile(file);
      if (headers.length === 0) {
        // Empty file — register an empty single-column table so the
        // query doesn't fail with "no such table" but also doesn't
        // surprise the user with a phantom row.
        let name = tableNameFor(file.name);
        let i = 2;
        while (usedNames.has(name)) name = `${tableNameFor(file.name)}_${i++}`;
        usedNames.add(name);
        db.exec(`CREATE TABLE ${quoteIdent(name)} (col_1 TEXT)`);
        continue;
      }
      let name = tableNameFor(file.name);
      let i = 2;
      while (usedNames.has(name)) name = `${tableNameFor(file.name)}_${i++}`;
      usedNames.add(name);

      const columnList = headers.map((h) => `${quoteIdent(h)} TEXT`).join(', ');
      db.exec(`CREATE TABLE ${quoteIdent(name)} (${columnList})`);

      // Bulk-insert inside a single transaction — orders of magnitude
      // faster than per-row commits for any meaningful row count.
      db.exec('BEGIN');
      try {
        const placeholders = headers.map(() => '?').join(', ');
        const insertSql = `INSERT INTO ${quoteIdent(name)} (${headers
          .map(quoteIdent)
          .join(', ')}) VALUES (${placeholders})`;
        const stmt = db.prepare(insertSql);
        try {
          for (const row of rows) {
            stmt.bind(row.map(toSqlBindable));
            stmt.stepReset();
          }
        } finally {
          stmt.finalize();
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }

    // Run the user's query. resultRows + rowMode 'array' gives us
    // [[v1, v2, ...], ...]; columnNames is filled in via the option.
    const columnNames: string[] = [];
    const resultRows = db.exec({
      sql,
      rowMode: 'array',
      returnValue: 'resultRows',
      columnNames,
    }) as unknown[][];
    return {
      columns: columnNames,
      rows: resultRows,
      rowCount: resultRows.length,
    };
  } finally {
    db.close();
  }
}
