import type { ToolModule, ToolRunContext } from '../../types.js';
import {
  readWorkbook,
  newWorkbook,
  addWorksheet,
  addAOAToSheet,
  sheetToAOA,
  writeWorkbookBuffer,
} from '../../lib/excel.js';

export type SplitSheetsParams = Record<string, never>;

const XLSX_ACCEPT = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

export const splitSheets: ToolModule<SplitSheetsParams> = {
  id: 'split-sheets',
  slug: 'split-sheets',
  name: 'Split Sheets',
  description: 'Split an Excel workbook into one XLSX file per sheet, downloaded as a ZIP.',
  category: 'edit',
  keywords: ['excel', 'xlsx', 'split', 'sheets', 'workbook', 'spreadsheet'],

  input: {
    accept: XLSX_ACCEPT,
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: {
    mime: 'application/zip',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {},

  async run(inputs: File[], _params: SplitSheetsParams, ctx: ToolRunContext): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const { default: JSZip } = await import('jszip');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Reading workbook' });

    const buffer = await inputs[0]!.arrayBuffer();
    const wb = await readWorkbook(buffer);

    if (wb.worksheets.length === 0) throw new Error('Workbook has no sheets');

    const zip = new JSZip();
    const total = wb.worksheets.length;

    for (let i = 0; i < total; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const src = wb.worksheets[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: 10 + Math.floor((i / total) * 80),
        message: `Splitting ${src.name}`,
      });

      const singleWb = await newWorkbook();
      const destWs = addWorksheet(singleWb, src.name);
      addAOAToSheet(destWs, sheetToAOA(src));

      const xlsxBuffer = await writeWorkbookBuffer(singleWb);
      const safeName = src.name.replace(/[/\\?*[\]:]/g, '_');
      zip.file(`${safeName}.xlsx`, xlsxBuffer);
    }

    ctx.onProgress({ stage: 'encoding', percent: 95, message: 'Creating ZIP' });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([await zipBlob.arrayBuffer()], { type: 'application/zip' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/zip'],
  },
};
