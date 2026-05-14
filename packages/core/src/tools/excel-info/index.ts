import type { ToolModule, ToolRunContext } from '../../types.js';

export type ExcelInfoParams = Record<string, never>;

const XLSX_ACCEPT = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

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

    const XLSX = await import('xlsx');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Reading workbook' });

    const buffer = await inputs[0]!.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

    let totalCells = 0;

    const perSheet = wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name]!;
      const ref = ws['!ref'];
      if (!ref) {
        return { name, rows: 0, cols: 0, preview: [] };
      }
      const range = XLSX.utils.decode_range(ref);
      const rows = range.e.r - range.s.r + 1;
      const cols = range.e.c - range.s.c + 1;
      totalCells += rows * cols;

      const allRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
      const preview = allRows.slice(0, 5);

      return { name, rows, cols, preview };
    });

    const result = {
      sheetCount: wb.SheetNames.length,
      sheetNames: wb.SheetNames,
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
