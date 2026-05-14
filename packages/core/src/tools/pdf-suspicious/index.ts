import type { ToolModule, ToolRunContext } from '../../types.js';
import { analyzeSuspicious, type TextSuspiciousParams, type TextSuspiciousResult } from '../text-suspicious/index.js';

export interface PdfSuspiciousParams extends TextSuspiciousParams {
  /** When true, return a per-page breakdown alongside the document-level verdict. */
  perPage?: boolean;
}

export const defaultPdfSuspiciousParams: PdfSuspiciousParams = {
  invisibleDensityThreshold: 0.001,
  nonAsciiThreshold: 0.5,
  confusableThreshold: 1,
  perPage: false,
};

export interface PdfSuspiciousResult {
  verdict: TextSuspiciousResult['verdict'];
  pageCount: number;
  document: TextSuspiciousResult;
  pages?: Array<{ page: number; result: TextSuspiciousResult }>;
}

const PdfSuspiciousComponentStub = (): unknown => null;

export const pdfSuspicious: ToolModule<PdfSuspiciousParams> = {
  id: 'pdf-suspicious',
  slug: 'pdf-suspicious',
  name: 'PDF Suspicious',
  description:
    'Scan a PDF for prompt-injection / homoglyph / invisible-character attacks. Extracts the text per page and runs text-suspicious over the whole document — and optionally each page individually. Useful when an LLM is about to ingest a PDF: catches Latin-spoofed phishing strings, zero-width prompt injections, and confusable-script substitutions before the model sees them.',
  category: 'inspect',
  presence: 'both',
  keywords: ['pdf', 'security', 'prompt-injection', 'confusable', 'audit', 'inspect'],

  input: {
    accept: ['application/pdf'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: defaultPdfSuspiciousParams,

  paramSchema: {
    perPage: {
      type: 'boolean',
      label: 'per-page breakdown',
      help: 'Include a separate verdict for each page in the output.',
    },
    invisibleDensityThreshold: {
      type: 'number',
      label: 'invisible density threshold',
      min: 0,
      max: 0.1,
      step: 0.0001,
    },
    nonAsciiThreshold: {
      type: 'number',
      label: 'non-ASCII threshold',
      min: 0,
      max: 1,
      step: 0.05,
    },
    confusableThreshold: {
      type: 'number',
      label: 'confusable threshold',
      min: 0,
      max: 100,
      step: 1,
    },
  },

  Component: PdfSuspiciousComponentStub,

  async run(inputs: File[], params: PdfSuspiciousParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('pdf-suspicious accepts exactly one PDF.');
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading PDF.js' });

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

    const buffer = await inputs[0]!.arrayBuffer();
    const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
    const numPages = pdf.numPages;
    const pageTexts: string[] = [];

    for (let i = 1; i <= numPages; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');
      ctx.onProgress({
        stage: 'processing',
        percent: Math.floor((i / numPages) * 70),
        message: `Extracting page ${i}/${numPages}`,
      });
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str ?? '' : ''))
        .join(' ');
      pageTexts.push(text);
    }

    ctx.onProgress({ stage: 'processing', percent: 80, message: 'Analyzing' });
    const fullText = pageTexts.join('\n\n');
    const document = analyzeSuspicious(fullText, params);

    const result: PdfSuspiciousResult = {
      verdict: document.verdict,
      pageCount: numPages,
      document,
    };
    if (params.perPage) {
      result.pages = pageTexts.map((t, i) => ({ page: i + 1, result: analyzeSuspicious(t, params) }));
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
