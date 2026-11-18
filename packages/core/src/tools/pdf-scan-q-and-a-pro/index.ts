import type { ToolModule, ToolRunContext } from '../../types.js';
import { assertPdfPageBudget } from '../../lib/budget.js';
import { parseRangeSpec } from '../../lib/pdf-ranges.js';
import { createCanvas, canvasToBlob } from '../../lib/canvas.js';
import { fileToBase64, runPro } from '../../lib/pro-runner.js';

export interface PdfScanQandAProParams {
  question: string;
  /** Pages to send, e.g. "1-3, 7". Empty means the first pages up to the cap. */
  pages: string;
}

export const defaultPdfScanQandAProParams: PdfScanQandAProParams = { question: '', pages: '' };

/** Server cap (functions/_lib/providers/scan-pdf-models.ts). Keep in sync. */
export const SCAN_PDF_MAX_PAGES = 10;
/** Longest rendered side in pixels. Enough for small print on a letter page. */
const MAX_SIDE_PX = 1536;
/** Server per-image cap is 2 MB; stay under it. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Average characters per page above which a PDF has a usable text layer. */
const TEXT_LAYER_CHARS_PER_PAGE = 200;

/**
 * Resolves which pages to send. An empty spec takes the first pages up to
 * the cap; an explicit spec must fit the cap. Exported for tests.
 */
export function selectScanPages(spec: string, numPages: number): number[] {
  const trimmed = spec.trim();
  if (!trimmed) {
    return Array.from({ length: Math.min(numPages, SCAN_PDF_MAX_PAGES) }, (_, i) => i + 1);
  }
  const parts = trimmed
    .split(',')
    .map((s) => s.replace(/\s+/g, ''))
    .filter(Boolean);
  const pages = parseRangeSpec(parts, numPages);
  if (pages.length > SCAN_PDF_MAX_PAGES) {
    throw new Error(
      `Pick at most ${SCAN_PDF_MAX_PAGES} pages per run (you picked ${pages.length}).`,
    );
  }
  return pages;
}

/** Plain-language notes appended to the answer. Exported for tests. */
export function scanNotes(opts: {
  sent: number[];
  numPages: number;
  explicit: boolean;
  textCharsPerPage: number;
}): string[] {
  const notes: string[] = [];
  if (!opts.explicit && opts.numPages > opts.sent.length) {
    notes.push(
      `Only pages 1-${opts.sent.length} of ${opts.numPages} were read. To ask about other pages, list them in the pages field, up to ${SCAN_PDF_MAX_PAGES} at a time.`,
    );
  }
  if (opts.textCharsPerPage >= TEXT_LAYER_CHARS_PER_PAGE) {
    notes.push(
      'This PDF has selectable text. Ask a PDF (pdf-q-and-a) reads the text of the whole document, up to 500 pages, instead of page images.',
    );
  }
  return notes;
}

export const pdfScanQandAPro: ToolModule<PdfScanQandAProParams> = {
  id: 'pdf-scan-q-and-a-pro',
  slug: 'pdf-scan-q-and-a-pro',
  name: 'Ask a Scanned PDF',
  description:
    'Answers a question about a scanned PDF that has no selectable text. Your browser renders up to 10 pages as images, then a hosted Gemma 4 vision model reads them. Uses 1 credit per run.',
  category: 'export',
  keywords: [
    'pdf',
    'scan',
    'scanned',
    'question',
    'answer',
    'vision',
    'ocr',
    'contract',
    'pro',
    'ai',
  ],

  input: { accept: ['application/pdf'], min: 1, max: 1, sizeLimit: 50 * 1024 * 1024 },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'medium',
  outputDisplay: 'prose',
  budget: { maxPages: 5_000 },

  chainSuggestions: ['text-translate-pro'],

  defaults: defaultPdfScanQandAProParams,
  paramSchema: {
    question: {
      type: 'string',
      label: 'question',
      placeholder: 'What is the termination notice period?',
      help: 'The question to answer from the scanned pages.',
      multiline: true,
    },
    pages: {
      type: 'string',
      label: 'pages',
      placeholder: '1-3, 7',
      help: `Up to ${SCAN_PDF_MAX_PAGES} pages per run. Leave empty to read the first ${SCAN_PDF_MAX_PAGES}.`,
    },
  },

  async run(inputs: File[], params: PdfScanQandAProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('pdf-scan-q-and-a-pro accepts exactly one PDF.');
    const question = params.question?.trim();
    if (!question) throw new Error('Enter a question to ask the PDF.');
    if (question.length > 2_000) throw new Error('Keep the question under 2,000 characters.');
    const spec = typeof params.pages === 'string' ? params.pages : '';

    ctx.onProgress({ stage: 'processing', percent: 5, message: 'Loading PDF' });
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (typeof window === 'undefined') {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      try {
        GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      } catch {
        GlobalWorkerOptions.workerSrc = 'pdf.worker.mjs';
      }
    }

    const task = getDocument({ data: new Uint8Array(await inputs[0]!.arrayBuffer()) });
    const images: { page: number; image: string }[] = [];
    let sent: number[];
    let numPages: number;
    let textChars = 0;
    try {
      const pdf = await task.promise;
      numPages = pdf.numPages;
      assertPdfPageBudget(numPages, { maxPages: 5_000 });
      sent = selectScanPages(spec, numPages);

      for (let i = 0; i < sent.length; i++) {
        if (ctx.signal.aborted) throw new Error('Aborted');
        const pageNum = sent[i]!;
        ctx.onProgress({
          stage: 'processing',
          percent: Math.floor(10 + (i / sent.length) * 60),
          message: `Rendering page ${pageNum}`,
        });
        const page = await pdf.getPage(pageNum);
        const text = await page.getTextContent();
        for (const item of text.items) {
          if ('str' in item) textChars += item.str.trim().length;
        }
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(MAX_SIDE_PX / Math.max(base.width, base.height), 4);
        const viewport = page.getViewport({ scale });
        const canvas = await createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({
          canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport,
        }).promise;
        let blob = await canvasToBlob(canvas, 'image/jpeg', 0.82);
        if (blob.size > MAX_IMAGE_BYTES) blob = await canvasToBlob(canvas, 'image/jpeg', 0.6);
        if (blob.size > MAX_IMAGE_BYTES) {
          throw new Error(`Page ${pageNum} is too detailed to send. Try fewer or different pages.`);
        }
        const b64 = await fileToBase64(new File([blob], `page-${pageNum}.jpg`));
        images.push({ page: pageNum, image: `data:image/jpeg;base64,${b64}` });
        page.cleanup();
      }
    } finally {
      await task.destroy();
    }

    ctx.onProgress({ stage: 'processing', percent: 75, message: 'Asking the vision model' });
    const result = await runPro<{ answer: string }>(
      'pdf-scan-q-and-a-pro',
      { question, pages: images, fileName: inputs[0]!.name },
      ctx,
    );

    const notes = scanNotes({
      sent,
      numPages,
      explicit: spec.trim().length > 0,
      textCharsPerPage: textChars / sent.length,
    });
    const body = notes.length
      ? `${result.answer}\n\n${notes.map((n) => `Note: ${n}`).join('\n')}`
      : result.answer;

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([body], { type: 'text/plain' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/plain'] },
};
