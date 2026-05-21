import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';
import { pdfToText } from '../pdf-to-text/index.js';

export interface PdfQandAParams {
  question: string;
}

export const defaultPdfQandAParams: PdfQandAParams = { question: '' };

async function extractPdfText(file: File, ctx: ToolRunContext): Promise<string> {
  const out = await pdfToText.run([file], { separator: '\n\n' }, ctx);
  const blob = Array.isArray(out) ? out[0]! : out;
  return (await blob.text()).trim();
}

export const pdfQandA: ToolModule<PdfQandAParams> = {
  id: 'pdf-q-and-a',
  slug: 'pdf-q-and-a',
  name: 'Ask a PDF',
  description:
    'Extracts a PDF’s text in your browser, then answers a question about it with a hosted LLM. Uses 2 credits per run.',
  category: 'export',
  keywords: ['pdf', 'question', 'answer', 'document', 'ask', 'pro', 'ai', 'llm'],

  input: { accept: ['application/pdf'], min: 1, max: 1, sizeLimit: 50 * 1024 * 1024 },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 2,
  memoryEstimate: 'medium',
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-translate-pro'],

  defaults: defaultPdfQandAParams,
  paramSchema: {
    question: {
      type: 'string',
      label: 'question',
      placeholder: 'What is the total on the invoice?',
      help: 'The question to answer from the PDF.',
      multiline: true,
    },
  },

  async run(
    inputs: File[],
    params: PdfQandAParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('pdf-q-and-a accepts exactly one PDF.');
    const question = params.question?.trim();
    if (!question) throw new Error('Enter a question to ask the PDF.');
    const text = await extractPdfText(inputs[0]!, ctx);
    if (!text) throw new Error('No extractable text found in the PDF.');
    const result = await runPro<{ answer: string }>(
      'pdf-q-and-a',
      { text, question, fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.answer], { type: 'text/plain' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/plain'] },
};
