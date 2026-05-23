import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';
import { pdfToText } from '../pdf-to-text/index.js';

export interface ChatLongPdfProParams {
  question: string;
}

export const defaultChatLongPdfProParams: ChatLongPdfProParams = { question: '' };

async function extractPdfText(file: File, ctx: ToolRunContext): Promise<string> {
  const out = await pdfToText.run([file], { separator: '\n\n' }, ctx);
  const blob = Array.isArray(out) ? out[0]! : out;
  return (await blob.text()).trim();
}

export const chatLongPdfPro: ToolModule<ChatLongPdfProParams> = {
  id: 'chat-long-pdf-pro',
  slug: 'chat-long-pdf-pro',
  name: 'Ask a Long PDF',
  description:
    'Hosted Llama 4 Scout with a 10M-token context window — for textbooks, court transcripts, large contracts, and books that exceed the standard Ask-a-PDF tool. Extracts text in your browser then sends to the long-context model. Uses 2 credits per run.',
  category: 'export',
  keywords: ['pdf', 'long', 'llama', 'scout', 'document', 'q-and-a', 'pro', 'llm'],

  input: { accept: ['application/pdf'], min: 1, max: 1, sizeLimit: 50 * 1024 * 1024 },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 2,
  memoryEstimate: 'medium',
  outputDisplay: 'prose',

  chainSuggestions: ['text-summarize-pro', 'text-to-speech-pro'],

  defaults: defaultChatLongPdfProParams,
  paramSchema: {
    question: {
      type: 'string',
      label: 'question',
      placeholder: 'Summarize chapter 3 in 5 bullet points',
      help: 'The question to answer using the document.',
      multiline: true,
    },
  },

  async run(
    inputs: File[],
    params: ChatLongPdfProParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('chat-long-pdf-pro accepts exactly one PDF.');
    const question = params.question?.trim();
    if (!question) throw new Error('Enter a question to ask the PDF.');
    const text = await extractPdfText(inputs[0]!, ctx);
    if (!text) throw new Error('No extractable text found in the PDF.');

    const result = await runPro<{ answer: string }>(
      'chat-long-pdf-pro',
      { text, question, fileName: inputs[0]!.name },
      ctx,
    );

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.answer], { type: 'text/plain' });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/plain'] },
};
