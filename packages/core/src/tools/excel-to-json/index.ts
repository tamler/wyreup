import type { ToolModule, ToolRunContext } from '../../types.js';

export interface ExcelToJsonParams {
  sheet?: string;
  arrayStyle?: 'objects' | 'arrays';
  includeHeaders?: boolean;
}

const XLSX_ACCEPT = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

export const excelToJson: ToolModule<ExcelToJsonParams> = {
  id: 'excel-to-json',
  slug: 'excel-to-json',
  name: 'Excel to JSON',
  description: 'Convert Excel workbooks (XLSX/XLS) to JSON. Supports single-sheet or all-sheets output.',
  category: 'convert',
  keywords: ['excel', 'xlsx', 'xls', 'json', 'convert', 'spreadsheet', 'data'],

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

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    sheet: 'all',
    arrayStyle: 'objects',
    includeHeaders: true,
  },

  paramSchema: {
    sheet: {
      type: 'string',
      label: 'Sheet',
      help: 'Sheet name, or "all" to export all sheets (default).',
      placeholder: 'all',
    },
    arrayStyle: {
      type: 'enum',
      label: 'Row format',
      options: [
        { value: 'objects', label: 'Objects ({"col": val})' },
        { value: 'arrays', label: 'Arrays ([val, val])' },
      ],
    },
    includeHeaders: {
      type: 'boolean',
      label: 'Include headers',
      help: 'For arrays mode: whether first row is treated as headers and included.',
    },
  },

  async run(
    inputs: File[],
    params: ExcelToJsonParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const XLSX = await import('xlsx');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Reading workbook' });

    const buffer = await inputs[0]!.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

    const sheetParam = (params.sheet ?? 'all').trim();
    const arrayStyle = params.arrayStyle ?? 'objects';
    const includeHeaders = params.includeHeaders !== false;

    const exportAll = sheetParam === '' || sheetParam.toLowerCase() === 'all';
    const sheetNames: string[] = exportAll
      ? wb.SheetNames
      : [sheetParam];

    const rowsOf = (name: string): unknown[] => {
      const ws = wb.Sheets[name];
      if (!ws) throw new Error(`Sheet "${name}" not found`);
      if (arrayStyle === 'objects') {
        return XLSX.utils.sheet_to_json<unknown>(ws, { defval: null });
      }
      // arrays mode
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
      if (!includeHeaders && rows.length > 0) {
        return rows.slice(1);
      }
      return rows;
    };

    const result: Record<string, unknown[]> = {};
    for (let i = 0; i < sheetNames.length; i++) {
      ctx.onProgress({
        stage: 'processing',
        percent: 20 + Math.floor((i / sheetNames.length) * 70),
        message: `Converting ${sheetNames[i]}`,
      });
      result[sheetNames[i]!] = rowsOf(sheetNames[i]!);
    }

    const output = { sheets: result };
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
