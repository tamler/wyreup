import type { ToolModule, ToolRunContext } from '../../types.js';
import type * as XLSXType from 'xlsx';

export interface JsonToExcelParams {
  sheetName?: string;
  boldHeaders?: boolean;
}

const JsonToExcelComponentStub = (): unknown => null;

/**
 * Accepts three JSON shapes:
 *   - [{col: val}, ...]               — array of objects
 *   - [[a, b], [c, d], ...]           — array of arrays
 *   - {sheets: {name: [rows], ...}}   — multi-sheet
 */
function buildWorkbook(
  XLSX: typeof XLSXType,
  data: unknown,
  sheetName: string,
): XLSXType.WorkBook {
  const wb = XLSX.utils.book_new();

  const appendSheet = (name: string, rows: unknown[]): void => {
    let ws: XLSXType.WorkSheet;
    if (Array.isArray(rows[0])) {
      // array of arrays
      ws = XLSX.utils.aoa_to_sheet(rows as unknown[][]);
    } else {
      // array of objects
      ws = XLSX.utils.json_to_sheet(rows as Record<string, unknown>[]);
    }
    let safeName = name.slice(0, 31).replace(/[/\\?*[\]:]/g, '_') || 'Sheet1';
    let suffix = 2;
    const base = safeName;
    while (wb.SheetNames.includes(safeName)) {
      safeName = `${base.slice(0, 28)}_${suffix++}`;
    }
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  };

  if (
    data !== null &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    'sheets' in data
  ) {
    const multi = (data as { sheets: Record<string, unknown[]> }).sheets;
    for (const [name, rows] of Object.entries(multi)) {
      if (!Array.isArray(rows)) throw new Error(`sheets.${name} must be an array`);
      appendSheet(name, rows);
    }
  } else if (Array.isArray(data)) {
    appendSheet(sheetName, data);
  } else {
    throw new Error(
      'JSON must be an array of objects, array of arrays, or { sheets: { name: [rows] } }',
    );
  }

  return wb;
}

export const jsonToExcel: ToolModule<JsonToExcelParams> = {
  id: 'json-to-excel',
  slug: 'json-to-excel',
  name: 'JSON to Excel',
  description: 'Convert JSON data to an Excel workbook. Supports arrays of objects, arrays of arrays, or multi-sheet format.',
  category: 'convert',
  presence: 'both',
  keywords: ['json', 'excel', 'xlsx', 'convert', 'spreadsheet', 'table', 'data'],

  input: {
    accept: ['application/json', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    multiple: false,
  },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    sheetName: 'Sheet1',
    boldHeaders: false,
  },

  paramSchema: {
    sheetName: {
      type: 'string',
      label: 'Sheet name',
      help: 'Used for single-sheet output. Ignored when input has a "sheets" key.',
      placeholder: 'Sheet1',
      maxLength: 31,
    },
    boldHeaders: {
      type: 'boolean',
      label: 'Bold header row',
      help: 'Note: style support requires the xlsx-style extension; this flag is recorded but may not render.',
    },
  },

  Component: JsonToExcelComponentStub,

  async run(
    inputs: File[],
    params: JsonToExcelParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Parsing JSON' });

    const text = await inputs[0]!.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON: ${(e as Error).message}`);
    }

    const XLSX = await import('xlsx');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Building workbook' });

    const sheetName = (params.sheetName ?? 'Sheet1').trim() || 'Sheet1';
    const wb = buildWorkbook(XLSX, data, sheetName);

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Writing workbook' });

    const xlsxBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([xlsxBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
};
