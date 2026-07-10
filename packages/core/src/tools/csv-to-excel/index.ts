import type { ToolModule, ToolRunContext } from '../../types.js';
import { newWorkbook, addWorksheet, addAOAToSheet, writeWorkbookBuffer } from '../../lib/excel.js';

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

export const csvToExcel: ToolModule<CsvToExcelParams> = {
  id: 'csv-to-excel',
  slug: 'csv-to-excel',
  name: 'CSV to Excel',
  description: 'Convert one or more CSV files into an Excel workbook. Each CSV becomes a sheet.',
  category: 'convert',
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

  async run(inputs: File[], params: CsvToExcelParams, ctx: ToolRunContext): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const Papa = (await import('papaparse')).default;
    const wb = await newWorkbook();
    const delimParam = params.delimiter ?? 'auto';
    const boldHeaders = params.boldHeaders ?? false;
    const sheetNameFromFilename = params.sheetNameFromFilename !== false;

    const usedNames = new Set<string>();

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

      const parsed = Papa.parse<string[]>(text, {
        header: false,
        delimiter: delim,
        skipEmptyLines: true,
      });
      const rows = parsed.data;

      let sheetName: string;
      if (sheetNameFromFilename) {
        const base = file.name.replace(/\.[^.]+$/, '');
        sheetName = base.slice(0, 31).replace(/[/\\?*[\]:]/g, '_') || `Sheet${i + 1}`;
      } else {
        sheetName = `Sheet${i + 1}`;
      }

      let finalName = sheetName;
      let suffix = 2;
      while (usedNames.has(finalName)) {
        finalName = `${sheetName.slice(0, 28)}_${suffix++}`;
      }
      usedNames.add(finalName);

      const ws = addWorksheet(wb, finalName);
      addAOAToSheet(ws, rows);

      if (boldHeaders && rows.length > 0) {
        const headerRow = ws.getRow(1);
        headerRow.font = { bold: true };
        headerRow.commit();
      }
    }

    ctx.onProgress({ stage: 'encoding', percent: 95, message: 'Writing workbook' });

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
