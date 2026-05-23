import type { ToolModule, ToolRunContext } from '../../types.js';
import { readWorkbook, sheetToAOA } from '../../lib/excel.js';

export type ExcelInfoParams = Record<string, never>;

const XLSX_ACCEPT = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

interface SheetSummary {
  name: string;
  rows: number;
  cols: number;
  preview: unknown[][];
}

export const excelInfo: ToolModule<ExcelInfoParams> = {
  id: 'excel-info',
  slug: 'excel-info',
  name: 'Excel Info',
  description: 'Inspect an Excel workbook: sheet names, row/column counts, and a data preview.',
  category: 'inspect',
  keywords: ['excel', 'xlsx', 'xls', 'inspect', 'info', 'metadata', 'sheets', 'spreadsheet'],

  input: {
    accept: XLSX_ACCEPT,
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {},

  async run(
    inputs: File[],
    _params: ExcelInfoParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Reading workbook' });

    const buffer = await inputs[0]!.arrayBuffer();
    const wb = await readWorkbook(buffer);

    let totalCells = 0;
    const names: string[] = [];

    const perSheet: SheetSummary[] = wb.worksheets.map((ws) => {
      names.push(ws.name);
      // Compute "used range" from actual row/col content rather than
      // trusting ws.rowCount (which can over-report on workbooks with
      // styled-but-empty rows). SheetJS's old behavior was to derive
      // from the data; matching that.
      const aoa = sheetToAOA(ws);
      const rows = aoa.length;
      const cols = aoa.reduce((max, row) => Math.max(max, row.length), 0);
      totalCells += rows * cols;
      return { name: ws.name, rows, cols, preview: aoa.slice(0, 5) };
    });

    const result = {
      sheetCount: names.length,
      sheetNames: names,
      totalCells,
      perSheet,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
