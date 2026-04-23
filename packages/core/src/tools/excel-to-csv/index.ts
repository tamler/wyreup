import type { ToolModule, ToolRunContext } from '../../types.js';

export interface ExcelToCsvParams {
  sheet?: string;
  delimiter?: ',' | ';' | '\t';
  includeHeaders?: boolean;
}

const XLSX_ACCEPT = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

const ExcelToCsvComponentStub = (): unknown => null;

export const excelToCsv: ToolModule<ExcelToCsvParams> = {
  id: 'excel-to-csv',
  slug: 'excel-to-csv',
  name: 'Excel to CSV',
  description: 'Convert Excel workbooks (XLSX/XLS) to CSV. Export one sheet or all sheets as a ZIP.',
  category: 'convert',
  presence: 'both',
  keywords: ['excel', 'xlsx', 'xls', 'csv', 'convert', 'spreadsheet', 'table'],

  input: {
    accept: XLSX_ACCEPT,
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: {
    mime: 'text/csv',
    multiple: false,
  },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    sheet: '',
    delimiter: ',',
    includeHeaders: true,
  },

  paramSchema: {
    sheet: {
      type: 'string',
      label: 'Sheet name',
      help: 'Leave blank to export first sheet. Enter "all" to export all sheets as a ZIP.',
      placeholder: 'Sheet1 (blank = first, "all" = zip)',
    },
    delimiter: {
      type: 'enum',
      label: 'Delimiter',
      options: [
        { value: ',', label: 'Comma (,)' },
        { value: ';', label: 'Semicolon (;)' },
        { value: '\t', label: 'Tab (\\t)' },
      ],
    },
    includeHeaders: {
      type: 'boolean',
      label: 'Include headers',
      help: 'When disabled, the first row is treated as data (not a header row).',
    },
  },

  Component: ExcelToCsvComponentStub,

  async run(
    inputs: File[],
    params: ExcelToCsvParams,
    ctx: ToolRunContext,
  ): Promise<Blob | Blob[]> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const XLSX = await import('xlsx');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Reading workbook' });

    const buffer = await inputs[0]!.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

    const sheetParam = (params.sheet ?? '').trim();
    const delimiter = params.delimiter ?? ',';
    const includeHeaders = params.includeHeaders !== false;

    const exportAll = sheetParam.toLowerCase() === 'all';

    const sheetNames: string[] = exportAll
      ? wb.SheetNames
      : [sheetParam || wb.SheetNames[0]!];

    if (sheetNames.length === 0) throw new Error('Workbook has no sheets');

    const csvOf = (name: string): string => {
      const ws = wb.Sheets[name];
      if (!ws) throw new Error(`Sheet "${name}" not found`);
      const csv = XLSX.utils.sheet_to_csv(ws, {
        FS: delimiter,
        blankrows: false,
      });
      if (!includeHeaders) {
        // Strip first line
        const nl = csv.indexOf('\n');
        return nl === -1 ? '' : csv.slice(nl + 1);
      }
      return csv;
    };

    if (!exportAll || sheetNames.length === 1) {
      const csv = csvOf(sheetNames[0]!);
      ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
      return new Blob([csv], { type: 'text/csv' });
    }

    // Multiple sheets → ZIP
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (let i = 0; i < sheetNames.length; i++) {
      ctx.onProgress({
        stage: 'processing',
        percent: 20 + Math.floor((i / sheetNames.length) * 70),
        message: `Exporting ${sheetNames[i]}`,
      });
      const csv = csvOf(sheetNames[i]!);
      const safeName = sheetNames[i]!.replace(/[/\\?*[\]:]/g, '_');
      zip.file(`${safeName}.csv`, csv);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([await zipBlob.arrayBuffer()], { type: 'application/zip' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/csv'],
  },
};
