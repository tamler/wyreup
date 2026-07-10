import type { ToolModule, ToolRunContext } from '../../types.js';
import {
  readWorkbook,
  newWorkbook,
  addWorksheet,
  addAOAToSheet,
  sheetToAOA,
  writeWorkbookBuffer,
} from '../../lib/excel.js';

export interface MergeWorkbooksParams {
  prefixSheetNames?: boolean;
}

const XLSX_ACCEPT = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

export const mergeWorkbooks: ToolModule<MergeWorkbooksParams> = {
  id: 'merge-workbooks',
  slug: 'merge-workbooks',
  name: 'Merge Workbooks',
  description:
    'Merge multiple Excel workbooks into one. Each source sheet appears as a sheet in the output. Cell values are preserved; complex cell formatting (styles, conditional formatting, charts) is not.',
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

  async run(inputs: File[], params: MergeWorkbooksParams, ctx: ToolRunContext): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const prefix = params.prefixSheetNames !== false;
    const outWb = await newWorkbook();
    const usedNames = new Set<string>();

    for (let fi = 0; fi < inputs.length; fi++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const file = inputs[fi]!;
      const fileBase = file.name
        .replace(/\.[^.]+$/, '')
        .slice(0, 15)
        .replace(/[/\\?*[\]:]/g, '_');

      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((fi / inputs.length) * 90),
        message: `Processing ${file.name}`,
      });

      const buffer = await file.arrayBuffer();
      const srcWb = await readWorkbook(buffer);

      for (const ws of srcWb.worksheets) {
        const safeSrc = ws.name.replace(/[/\\?*[\]:]/g, '_');
        let candidateName = prefix ? `${fileBase}_${safeSrc}`.slice(0, 31) : safeSrc.slice(0, 31);

        let suffix = 2;
        const base = candidateName;
        while (usedNames.has(candidateName)) {
          candidateName = `${base.slice(0, 28)}_${suffix++}`;
        }
        usedNames.add(candidateName);

        const destWs = addWorksheet(outWb, candidateName);
        addAOAToSheet(destWs, sheetToAOA(ws));
      }
    }

    ctx.onProgress({ stage: 'encoding', percent: 95, message: 'Writing workbook' });

    const xlsxBuffer = await writeWorkbookBuffer(outWb);

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
