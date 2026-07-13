import type { ToolModule, ToolRunContext } from '../../types.js';
import { assertPdfPageBudget } from '../../lib/budget.js';
import { runPro } from '../../lib/pro-runner.js';
import { pdfToText } from '../pdf-to-text/index.js';
import { textTranslate } from '../text-translate/index.js';
import { translateManyPro } from '../translate-many-pro/index.js';

export interface TranslateDocumentProParams {
  source?: string;
  target?: string;
}

export const defaultTranslateDocumentProParams: TranslateDocumentProParams = {
  source: 'en',
  target: 'es',
};

const translateManySourceSchema = translateManyPro.paramSchema?.source;
const textTranslateSourceSchema = textTranslate.paramSchema?.sourceLang;
const M2M100_LANGUAGE_OPTIONS =
  translateManySourceSchema?.type === 'enum'
    ? translateManySourceSchema.options
    : textTranslateSourceSchema?.type === 'enum'
      ? textTranslateSourceSchema.options
      : [];

async function extractPdfText(file: File, ctx: ToolRunContext): Promise<string> {
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

  const probeBuffer = await file.arrayBuffer();
  const probeDoc = await getDocument({
    data: new Uint8Array(probeBuffer),
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
  }).promise;
  try {
    assertPdfPageBudget(probeDoc.numPages, { maxPages: 40 });
  } finally {
    await probeDoc.destroy();
  }

  const out = await pdfToText.run([file], { separator: '\n\n' }, ctx);
  const blob = Array.isArray(out) ? out[0]! : out;
  return (await blob.text()).trim();
}

export const translateDocumentPro: ToolModule<TranslateDocumentProParams> = {
  id: 'translate-document-pro',
  slug: 'translate-document-pro',
  name: 'Translate a Document',
  description:
    'Translate a whole PDF or text file across 100+ languages, powered by a hosted translation model. Text is extracted on your device; only the text is sent. Output is plain text — chains into summarize, text-to-speech, and PDF tools. Uses 3 credits per run. Documents up to 40 pages.',
  category: 'text',
  keywords: ['translate', 'document', 'pdf', 'language', 'pro', 'hosted'],

  input: {
    accept: ['application/pdf', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 3,
  memoryEstimate: 'medium',
  outputDisplay: 'prose',
  budget: { maxPages: 40 },

  chainSuggestions: [
    'text-summarize',
    'word-counter',
    'html-to-pdf',
    'text-to-speech-pro',
  ],

  defaults: defaultTranslateDocumentProParams,
  paramSchema: {
    source: {
      type: 'enum',
      label: 'source language',
      options: M2M100_LANGUAGE_OPTIONS,
    },
    target: {
      type: 'enum',
      label: 'target language',
      options: M2M100_LANGUAGE_OPTIONS,
    },
  },

  async run(
    inputs: File[],
    params: TranslateDocumentProParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) {
      throw new Error('translate-document-pro accepts exactly one PDF or text file.');
    }

    const input = inputs[0]!;
    let text: string;
    if (input.type === 'application/pdf') {
      text = await extractPdfText(input, ctx);
    } else if (input.type === 'text/plain') {
      text = (await input.text()).trim();
    } else {
      throw new Error('translate-document-pro accepts PDF or plain-text files.');
    }

    if (!text) {
      throw new Error('No readable text found — scanned PDFs need OCR first.');
    }

    const source = (params.source ?? 'en').trim() || 'en';
    const target = (params.target ?? 'es').trim() || 'es';
    const result = await runPro<{ text: string }>(
      'translate-document-pro',
      { text, source, target },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.text], { type: 'text/plain' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/plain'] },
};
