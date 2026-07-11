import type { ToolModule, ToolRunContext } from '../../types.js';
import { assertPdfPageBudget } from '../../lib/budget.js';

export interface PdfFlattenParams {
  /** Update the document's "Title" field to reflect that the PDF is flattened. */
  markAsFlattened?: boolean;
}

export const defaultPdfFlattenParams: PdfFlattenParams = {
  markAsFlattened: false,
};

export const pdfFlatten: ToolModule<PdfFlattenParams> = {
  id: 'pdf-flatten',
  slug: 'pdf-flatten',
  name: 'Flatten PDF Form',
  description:
    "Lock interactive form fields into the page content so values can't be edited or cleared. Useful before sending a filled form back to a counterparty. A PDF with no form fields passes through unchanged. Runs entirely in your browser.",
  category: 'pdf',
  keywords: ['pdf', 'flatten', 'form', 'lock', 'fields', 'finalize', 'static'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'application/pdf' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  budget: { maxPages: 2_000 },

  chainSuggestions: ['pdf-encrypt', 'pdf-redact', 'pdf-info'],

  defaults: defaultPdfFlattenParams,
  paramSchema: {
    markAsFlattened: {
      type: 'boolean',
      label: 'mark in metadata',
      help: 'Update the PDF Title metadata to "<original> (flattened)" so the change is discoverable later.',
    },
  },

  async run(inputs: File[], params: PdfFlattenParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('pdf-flatten accepts exactly one file.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Loading PDF' });

    const { PDFDocument } = await import('@cantoo/pdf-lib');
    if (ctx.signal.aborted) throw new Error('Aborted');

    const inputBytes = await inputs[0]!.arrayBuffer();
    const doc = await PDFDocument.load(inputBytes);
    assertPdfPageBudget(doc.getPageCount(), { maxPages: 2_000 });

    if (ctx.signal.aborted) throw new Error('Aborted');
    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Flattening fields' });

    const form = doc.getForm();
    const fieldCount = form.getFields().length;
    if (fieldCount === 0) {
      // No-op: nothing to flatten. We still return the original bytes so
      // chains don't break, but signal it via the progress message.
      ctx.onProgress({
        stage: 'processing',
        percent: 95,
        message: 'No interactive fields — passing PDF through unchanged',
      });
    } else {
      form.flatten();
    }

    if (params.markAsFlattened === true && fieldCount > 0) {
      const original = doc.getTitle() ?? '';
      doc.setTitle(original ? `${original} (flattened)` : 'flattened');
    }

    const bytes = await doc.save();
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/pdf'],
  },
};
