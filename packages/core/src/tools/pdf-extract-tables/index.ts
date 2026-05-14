import type { ToolModule, ToolRunContext } from '../../types.js';

export interface PdfExtractTablesParams {
  /** Output format. Default 'json'. */
  format?: 'json' | 'csv';
  /** Page to extract from (1-indexed). If omitted, extracts from all pages. */
  page?: number;
  /** Row detection tolerance in PDF points. Default 3. Higher = more forgiving. */
  rowTolerance?: number;
}

const defaults: Required<Omit<PdfExtractTablesParams, 'page'>> = {
  format: 'json',
  rowTolerance: 3,
};

export interface TableRow {
  page: number;
  rows: string[][];
}

/**
 * Group text items by y-coordinate within a tolerance.
 * Returns rows sorted top-to-bottom, items sorted left-to-right within each row.
 */
function groupIntoRows(
  items: Array<{ str: string; x: number; y: number }>,
  tolerance: number,
): string[][] {
  if (items.length === 0) return [];

  // Sort by y descending (PDF y=0 is bottom)
  const sorted = items.slice().sort((a, b) => b.y - a.y);

  const rows: Array<{ y: number; cells: Array<{ x: number; str: string }> }> = [];

  for (const item of sorted) {
    if (!item.str.trim()) continue;

    const existing = rows.find((r) => Math.abs(r.y - item.y) <= tolerance);
    if (existing) {
      existing.cells.push({ x: item.x, str: item.str });
    } else {
      rows.push({ y: item.y, cells: [{ x: item.x, str: item.str }] });
    }
  }

  return rows.map((row) =>
    row.cells
      .sort((a, b) => a.x - b.x)
      .map((c) => c.str.trim()),
  );
}

function rowsToCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row.map((cell) => {
        const escaped = cell.replace(/"/g, '""');
        return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
      }).join(','),
    )
    .join('\n');
}

export const pdfExtractTables: ToolModule<PdfExtractTablesParams> = {
  id: 'pdf-extract-tables',
  slug: 'pdf-extract-tables',
  name: 'Extract PDF Tables',
  description:
    'Extract tabular data from a PDF as JSON or CSV. ' +
    'Works well for simple tables with aligned columns and no merged cells. ' +
    'Complex tables, rotated text, and scanned PDFs (images) will not extract cleanly.',
  llmDescription:
    'Extract tabular data from a PDF and return it as JSON or CSV. Use when the user wants the data from tables inside a PDF.',
  category: 'export',
  keywords: ['pdf', 'table', 'extract', 'csv', 'json', 'data'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults,

  async run(
    inputs: File[],
    params: PdfExtractTablesParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const format = params.format ?? defaults.format;
    const rowTolerance = params.rowTolerance ?? defaults.rowTolerance;
    const targetPage = params.page;

    if (targetPage !== undefined && (targetPage < 1 || !Number.isInteger(targetPage))) {
      throw new Error('page must be a positive integer.');
    }

    ctx.onProgress({ stage: 'processing', percent: 5, message: 'Loading PDF' });

    const { getDocument, GlobalWorkerOptions } = await import(
      'pdfjs-dist/legacy/build/pdf.mjs'
    );

    if (typeof window === 'undefined') {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      try {
        const workerPath: string = require.resolve(
          'pdfjs-dist/legacy/build/pdf.worker.mjs',
        );
        GlobalWorkerOptions.workerSrc = workerPath;
      } catch {
        GlobalWorkerOptions.workerSrc = 'pdf.worker.mjs';
      }
    }

    const buffer = await inputs[0]!.arrayBuffer();
    const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
    const pageCount: number = pdf.numPages;

    if (targetPage !== undefined && targetPage > pageCount) {
      throw new Error(
        `Page ${targetPage} is out of range (document has ${pageCount} page${pageCount === 1 ? '' : 's'}).`,
      );
    }

    const pageNumbers = targetPage
      ? [targetPage]
      : Array.from({ length: pageCount }, (_, i) => i + 1);

    const allTables: TableRow[] = [];

    for (let idx = 0; idx < pageNumbers.length; idx++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const pageNum = pageNumbers[idx]!;
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor(10 + (idx / pageNumbers.length) * 80),
        message: `Processing page ${pageNum}/${pageCount}`,
      });

      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const items = (textContent.items as Array<{ str: string; transform: number[] }>)
        .filter((item) => item.str && item.transform)
        .map((item) => ({
          str: item.str,
          x: item.transform[4]!,
          y: item.transform[5]!,
        }));

      const rows = groupIntoRows(items, rowTolerance);
      allTables.push({ page: pageNum, rows });
    }

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Formatting output' });

    let outputBlob: Blob;
    if (format === 'csv') {
      // For CSV, combine all pages with a page header
      const lines: string[] = [];
      for (const table of allTables) {
        if (table.rows.length > 0) {
          if (allTables.length > 1) {
            lines.push(`# Page ${table.page}`);
          }
          lines.push(rowsToCsv(table.rows));
        }
      }
      outputBlob = new Blob([lines.join('\n')], { type: 'text/csv' });
    } else {
      outputBlob = new Blob([JSON.stringify(allTables, null, 2)], {
        type: 'application/json',
      });
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return outputBlob;
  },

  __testFixtures: {
    valid: ['doc-a.pdf'],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
