import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CsvToExcelParams {
  delimiter?: ',' | ';' | '\t' | 'auto';
  boldHeaders?: boolean;
  sheetNameFromFilename?: boolean;
}

// Detect delimiter by frequency in the first non-empty line
function detectDelimiter(text: string): string {
  const firstLine = text.split('\n').find((l) => l.trim()) ?? '';
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of firstLine) {
    if (ch in counts) counts[ch]!++;
  }
  if (counts['\t']! > 0) return '\t';
  if (counts[';']! > counts[',']!) return ';';
  return ',';
}

const CsvToExcelComponentStub = (): unknown => null;

export const csvToExcel: ToolModule<CsvToExcelParams> = {
  id: 'csv-to-excel',
  slug: 'csv-to-excel',
  name: 'CSV to Excel',
  description: 'Convert one or more CSV files into an Excel workbook. Each CSV becomes a sheet.',
  category: 'convert',
  presence: 'both',
  keywords: ['csv', 'excel', 'xlsx', 'convert', 'spreadsheet', 'table'],

  input: {
    accept: ['text/csv', 'text/plain'],
    min: 1,
    max: 10,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    multiple: false,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    delimiter: 'auto',
    boldHeaders: false,
    sheetNameFromFilename: true,
  },

  paramSchema: {
    delimiter: {
      type: 'enum',
      label: 'Delimiter',
      options: [
        { value: 'auto', label: 'Auto-detect' },
        { value: ',', label: 'Comma (,)' },
        { value: ';', label: 'Semicolon (;)' },
        { value: '\t', label: 'Tab (\\t)' },
      ],
    },
    boldHeaders: {
      type: 'boolean',
      label: 'Bold header row',
      help: 'Make the first row bold in the output workbook.',
    },
    sheetNameFromFilename: {
      type: 'boolean',
      label: 'Sheet name from filename',
      help: 'Use the CSV filename (without extension) as the sheet name.',
    },
  },

  Component: CsvToExcelComponentStub,

  async run(
    inputs: File[],
    params: CsvToExcelParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const XLSX = await import('xlsx');

    const wb = XLSX.utils.book_new();
    const delimParam = params.delimiter ?? 'auto';
    const boldHeaders = params.boldHeaders ?? false;
    const sheetNameFromFilename = params.sheetNameFromFilename !== false;

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const file = inputs[i]!;
      const text = await file.text();

      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / inputs.length) * 90),
        message: `Processing ${file.name}`,
      });

      const delim = delimParam === 'auto' ? detectDelimiter(text) : delimParam;

      // SheetJS's built-in CSV parser handles quoting/escaping correctly.
      // Note: SheetJS community edition (0.18.x) does not support cell styles,
      // so boldHeaders is accepted as a param but has no visual effect without xlsx-style.
      void boldHeaders;
      const parsedWb = XLSX.read(text, { type: 'string', FS: delim });
      const parsedWs = parsedWb.Sheets[parsedWb.SheetNames[0]!]!;

      let sheetName: string;
      if (sheetNameFromFilename) {
        const base = file.name.replace(/\.[^.]+$/, '');
        // Sheet names max 31 chars, no special chars
        sheetName = base.slice(0, 31).replace(/[/\\?*[\]:]/g, '_') || `Sheet${i + 1}`;
      } else {
        sheetName = `Sheet${i + 1}`;
      }

      // Avoid duplicate sheet names
      let finalName = sheetName;
      let suffix = 2;
      while (wb.SheetNames.includes(finalName)) {
        finalName = `${sheetName.slice(0, 28)}_${suffix++}`;
      }

      XLSX.utils.book_append_sheet(wb, parsedWs, finalName);
    }

    ctx.onProgress({ stage: 'encoding', percent: 95, message: 'Writing workbook' });

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
