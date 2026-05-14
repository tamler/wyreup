import type { ToolModule, ToolRunContext } from '../../types.js';

export interface MergeWorkbooksParams {
  prefixSheetNames?: boolean;
}

const XLSX_ACCEPT = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export const mergeWorkbooks: ToolModule<MergeWorkbooksParams> = {
  id: 'merge-workbooks',
  slug: 'merge-workbooks',
  name: 'Merge Workbooks',
  description: 'Merge multiple Excel workbooks into one. Each source sheet appears as a sheet in the output.',
  category: 'edit',
  keywords: ['excel', 'xlsx', 'merge', 'combine', 'workbook', 'spreadsheet', 'sheets'],

  input: {
    accept: XLSX_ACCEPT,
    min: 2,
    max: 20,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    prefixSheetNames: true,
  },

  paramSchema: {
    prefixSheetNames: {
      type: 'boolean',
      label: 'Prefix sheet names',
      help: 'Prefix each sheet with its source filename to avoid name collisions.',
    },
  },

  async run(
    inputs: File[],
    params: MergeWorkbooksParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const XLSX = await import('xlsx');
    const prefix = params.prefixSheetNames !== false;

    const outWb = XLSX.utils.book_new();

    for (let fi = 0; fi < inputs.length; fi++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const file = inputs[fi]!;
      const fileBase = file.name.replace(/\.[^.]+$/, '').slice(0, 15).replace(/[/\\?*[\]:]/g, '_');

      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((fi / inputs.length) * 90),
        message: `Processing ${file.name}`,
      });

      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName]!;
        const safeSrc = sheetName.replace(/[/\\?*[\]:]/g, '_');
        let candidateName = prefix ? `${fileBase}_${safeSrc}`.slice(0, 31) : safeSrc.slice(0, 31);

        let suffix = 2;
        const base = candidateName;
        while (outWb.SheetNames.includes(candidateName)) {
          candidateName = `${base.slice(0, 28)}_${suffix++}`;
        }

        XLSX.utils.book_append_sheet(outWb, ws, candidateName);
      }
    }

    ctx.onProgress({ stage: 'encoding', percent: 95, message: 'Writing workbook' });

    const xlsxBuffer = XLSX.write(outWb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

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
