import type { ToolModule, ToolRunContext } from '../../types.js';
import { assertPdfPageBudget } from '../../lib/budget.js';
import { runPro } from '../../lib/pro-runner.js';
import { pdfToText } from '../pdf-to-text/index.js';

async function extractPdfText(file: File, ctx: ToolRunContext): Promise<string> {
  const out = await pdfToText.run([file], { separator: '\n\n' }, ctx);
  const blob = Array.isArray(out) ? out[0]! : out;
  return (await blob.text()).trim();
}

export const pdfSummarize: ToolModule<Record<string, never>> = {
  id: 'pdf-summarize',
  slug: 'pdf-summarize',
  name: 'Summarize PDF',
  description:
    'Extracts a PDF’s text in your browser, then summarizes it with a hosted LLM. Uses 2 credits per run.',
  category: 'export',
  keywords: ['pdf', 'summarize', 'summary', 'document', 'pro', 'ai', 'llm'],

  input: { accept: ['application/pdf'], min: 1, max: 1, sizeLimit: 50 * 1024 * 1024 },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 2,
  memoryEstimate: 'medium',
  outputDisplay: 'prose',
  budget: { maxPages: 500 },

  chainSuggestions: ['text-sentences', 'word-counter', 'text-translate-pro'],

  defaults: {},
  paramSchema: {},

  async run(inputs: File[], _params: Record<string, never>, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('pdf-summarize accepts exactly one PDF.');

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
    const probeBuffer = await inputs[0]!.arrayBuffer();
    const probeDoc = await getDocument({
      data: new Uint8Array(probeBuffer),
      disableFontFace: true,
      disableRange: true,
      disableStream: true,
    }).promise;
    assertPdfPageBudget(probeDoc.numPages, { maxPages: 500 });
    await probeDoc.destroy();

    const text = await extractPdfText(inputs[0]!, ctx);
    if (!text) throw new Error('No extractable text found in the PDF.');
    const result = await runPro<{ summary: string }>(
      'pdf-summarize',
      { text, fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.summary], { type: 'text/plain' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/plain'] },
};
