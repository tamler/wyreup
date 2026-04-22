import type { ToolModule, ToolRunContext } from '../../types.js';
import { getPipeline } from '../../lib/transformers.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TextSentimentParams {}

export const defaultTextSentimentParams: TextSentimentParams = {};

export interface TextSentimentResult {
  label: 'POSITIVE' | 'NEGATIVE';
  score: number;
}

// DistilBERT SST-2 — Apache 2.0 licensed, ~65 MB
// https://huggingface.co/Xenova/distilbert-base-uncased-finetuned-sst-2-english
const MODEL_ID = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';

const TextSentimentComponentStub = (): unknown => null;

export const textSentiment: ToolModule<TextSentimentParams> = {
  id: 'text-sentiment',
  slug: 'text-sentiment',
  name: 'Sentiment Analysis',
  description: 'Classify text as positive or negative — runs entirely on your device.',
  category: 'text',
  presence: 'both',
  keywords: ['sentiment', 'emotion', 'positive', 'negative', 'classify', 'nlp', 'opinion'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 1 * 1024 * 1024, // 1 MB — NLP models have token limits
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  installSize: 65_000_000, // ~65 MB DistilBERT
  installGroup: 'nlp-standard',
  requires: { webgpu: 'preferred' },

  defaults: defaultTextSentimentParams,
  Component: TextSentimentComponentStub,

  async run(inputs: File[], _params: TextSentimentParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('text-sentiment accepts exactly one text file.');
    }
    const input = inputs[0]!;

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading sentiment model' });

    const pipe = await getPipeline(ctx, 'sentiment-analysis', MODEL_ID) as (
      input: string,
    ) => Promise<Array<{ label: string; score: number }> | { label: string; score: number }>;

    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await input.text();
    if (!text.trim()) {
      throw new Error('Input text is empty.');
    }

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Analyzing sentiment' });

    const rawResult = await pipe(text);
    const item = Array.isArray(rawResult) ? rawResult[0]! : rawResult;

    const result: TextSentimentResult = {
      label: (item.label === 'POSITIVE' ? 'POSITIVE' : 'NEGATIVE'),
      score: Math.round(item.score * 10000) / 10000,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: ['sample.txt'],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
