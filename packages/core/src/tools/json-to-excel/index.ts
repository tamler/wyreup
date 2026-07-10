import type { ToolModule, ToolRunContext } from '../../types.js';
import type { Workbook } from 'exceljs';
import {
  newWorkbook,
  addWorksheet,
  addAOAToSheet,
  addObjectsToSheet,
  writeWorkbookBuffer,
} from '../../lib/excel.js';

export interface JsonToExcelParams {
  sheetName?: string;
  boldHeaders?: boolean;
}

/**
 * Accepts three JSON shapes:
 *   - [{col: val}, ...]               — array of objects
 *   - [[a, b], [c, d], ...]           — array of arrays
 *   - {sheets: {name: [rows], ...}}   — multi-sheet
 */
async function buildWorkbook(
  data: unknown,
  sheetName: string,
  boldHeaders: boolean,
): Promise<Workbook> {
  const wb = await newWorkbook();
  const usedNames = new Set<string>();

  const appendSheet = (name: string, rows: unknown[]): void => {
    let safeName = name.slice(0, 31).replace(/[/\\?*[\]:]/g, '_') || 'Sheet1';
    let suffix = 2;
    const base = safeName;
    while (usedNames.has(safeName)) {
      safeName = `${base.slice(0, 28)}_${suffix++}`;
    }
    usedNames.add(safeName);

    const ws = addWorksheet(wb, safeName);
    if (Array.isArray(rows[0])) {
      addAOAToSheet(ws, rows as unknown[][]);
    } else {
      addObjectsToSheet(ws, rows as Record<string, unknown>[]);
    }
    if (boldHeaders && rows.length > 0) {
      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true };
      headerRow.commit();
    }
  };

  if (data !== null && typeof data === 'object' && !Array.isArray(data) && 'sheets' in data) {
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
  description:
    'Convert JSON data to an Excel workbook. Supports arrays of objects, arrays of arrays, or multi-sheet format.',
  category: 'convert',
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
      help: 'Make the first row bold in the output workbook.',
    },
  },

  async run(inputs: File[], params: JsonToExcelParams, ctx: ToolRunContext): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Parsing JSON' });

    const text = await inputs[0]!.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON: ${(e as Error).message}`);
    }

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Building workbook' });

    const sheetName = (params.sheetName ?? 'Sheet1').trim() || 'Sheet1';
    const boldHeaders = params.boldHeaders ?? false;
    const wb = await buildWorkbook(data, sheetName, boldHeaders);

    ctx.onProgress({ stage: 'encoding', percent: 90, message: 'Writing workbook' });

    const xlsxBuffer = await writeWorkbookBuffer(wb);

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
