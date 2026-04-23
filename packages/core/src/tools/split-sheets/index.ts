import type { ToolModule, ToolRunContext } from '../../types.js';

export type SplitSheetsParams = Record<string, never>;

const XLSX_ACCEPT = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const SplitSheetsComponentStub = (): unknown => null;

export const splitSheets: ToolModule<SplitSheetsParams> = {
  id: 'split-sheets',
  slug: 'split-sheets',
  name: 'Split Sheets',
  description: 'Split an Excel workbook into one XLSX file per sheet, downloaded as a ZIP.',
  category: 'edit',
  presence: 'both',
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

  Component: SplitSheetsComponentStub,

  async run(
    inputs: File[],
    _params: SplitSheetsParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const XLSX = await import('xlsx');
    const { default: JSZip } = await import('jszip');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Reading workbook' });

    const buffer = await inputs[0]!.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

    if (wb.SheetNames.length === 0) throw new Error('Workbook has no sheets');

    const zip = new JSZip();

    for (let i = 0; i < wb.SheetNames.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const name = wb.SheetNames[i]!;
      ctx.onProgress({
        stage: 'processing',
        percent: 10 + Math.floor((i / wb.SheetNames.length) * 80),
        message: `Splitting ${name}`,
      });

      const singleWb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(singleWb, wb.Sheets[name]!, name);

      const xlsxBuffer = XLSX.write(singleWb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      const safeName = name.replace(/[/\\?*[\]:]/g, '_');
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
