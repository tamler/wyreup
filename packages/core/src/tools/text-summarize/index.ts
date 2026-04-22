import type { ToolModule, ToolRunContext } from '../../types.js';
import { getPipeline } from '../../lib/transformers.js';

export interface TextSummarizeParams {
  /** Maximum length of the generated summary in tokens. Default 100. */
  maxLength?: number;
  /** Minimum length of the generated summary in tokens. Default 30. */
  minLength?: number;
}

export const defaultTextSummarizeParams: TextSummarizeParams = {
  maxLength: 100,
  minLength: 30,
};

// DistilBART CNN 6-6 — Apache 2.0 licensed, ~80 MB
// https://huggingface.co/Xenova/distilbart-cnn-6-6
const MODEL_ID = 'Xenova/distilbart-cnn-6-6';

const TextSummarizeComponentStub = (): unknown => null;

export const textSummarize: ToolModule<TextSummarizeParams> = {
  id: 'text-summarize',
  slug: 'text-summarize',
  name: 'Summarize Text',
  description: 'Generate a concise summary of any long text — runs entirely on your device.',
  category: 'text',
  presence: 'both',
  keywords: ['summarize', 'summary', 'condense', 'abstract', 'tldr', 'nlp', 'shorten'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 1 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  installSize: 80_000_000, // ~80 MB DistilBART
  installGroup: 'nlp-standard',
  requires: { webgpu: 'preferred' },

  defaults: defaultTextSummarizeParams,
  Component: TextSummarizeComponentStub,

  async run(inputs: File[], params: TextSummarizeParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('text-summarize accepts exactly one text file.');
    }
    const input = inputs[0]!;

    const maxLength = params.maxLength ?? 100;
    const minLength = params.minLength ?? 30;

    if (maxLength < minLength) {
      throw new Error('maxLength must be greater than or equal to minLength.');
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading summarization model' });

    const pipe = await getPipeline(ctx, 'summarization', MODEL_ID) as (
      input: string,
      options?: Record<string, unknown>,
    ) => Promise<Array<{ summary_text: string }>>;

    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await input.text();
    if (!text.trim()) {
      throw new Error('Input text is empty.');
    }

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Generating summary' });

    const result = await pipe(text, { max_new_tokens: maxLength, min_length: minLength });
    const summary = Array.isArray(result) ? result[0]?.summary_text ?? '' : String(result);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([summary], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: ['sample.txt'],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
