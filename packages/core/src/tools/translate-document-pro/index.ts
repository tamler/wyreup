import type { ToolModule, ToolRunContext } from '../../types.js';
import { assertPdfPageBudget } from '../../lib/budget.js';
import { runPro } from '../../lib/pro-runner.js';
import { pdfToText } from '../pdf-to-text/index.js';

export interface TranslateDocumentProParams {
  source?: string;
  target?: string;
}

export const defaultTranslateDocumentProParams: TranslateDocumentProParams = {
  source: 'en',
  target: 'es',
};

// Curated m2m100 language list for the document UI. Superset of the
// text-translate dropdown plus the languages our real traffic speaks
// (Filipino, Khmer, Burmese, Lao, Bengali, Tamil, Urdu, Persian, Swahili).
const M2M100_LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese (Simplified)' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'it', label: 'Italian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'th', label: 'Thai' },
  { value: 'id', label: 'Indonesian' },
  { value: 'tl', label: 'Filipino (Tagalog)' },
  { value: 'ms', label: 'Malay' },
  { value: 'km', label: 'Khmer' },
  { value: 'my', label: 'Burmese' },
  { value: 'lo', label: 'Lao' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ta', label: 'Tamil' },
  { value: 'ur', label: 'Urdu' },
  { value: 'fa', label: 'Persian' },
  { value: 'sw', label: 'Swahili' },
  { value: 'sv', label: 'Swedish' },
  { value: 'da', label: 'Danish' },
  { value: 'no', label: 'Norwegian' },
  { value: 'fi', label: 'Finnish' },
  { value: 'el', label: 'Greek' },
  { value: 'he', label: 'Hebrew' },
  { value: 'cs', label: 'Czech' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'ro', label: 'Romanian' },
  { value: 'uk', label: 'Ukrainian' },
];

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
    'Translate a whole PDF or text file across 35+ languages, powered by a hosted translation model. Text is extracted on your device; only the text is sent. Output is plain text — chains into summarize, text-to-speech, and PDF tools. Uses 3 credits per run. Documents up to 40 pages.',
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
