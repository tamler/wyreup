import type { ToolModule, ToolRunContext } from '../../types.js';
import { getPipeline } from '../../lib/transformers.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TextEmbedParams {}

export const defaultTextEmbedParams: TextEmbedParams = {};

export interface TextEmbedResult {
  embeddings: number[][];
  pairwise: Array<{ a: number; b: number; cosine: number }>;
}

// all-MiniLM-L6-v2 — Apache 2.0 licensed, ~23 MB
// https://huggingface.co/Xenova/all-MiniLM-L6-v2
// Tiny and fast: 384-dimensional sentence embeddings.
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/**
 * Cosine similarity between two equal-length vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

const TextEmbedComponentStub = (): unknown => null;

export const textEmbed: ToolModule<TextEmbedParams> = {
  id: 'text-embed',
  slug: 'text-embed',
  name: 'Text Embeddings',
  description: 'Compute semantic embeddings and pairwise similarity for text files — runs on your device.',
  category: 'text',
  presence: 'both',
  keywords: ['embed', 'embedding', 'semantic', 'similarity', 'sentence', 'vector', 'nlp', 'search'],

  input: {
    accept: ['text/plain'],
    min: 1,
    sizeLimit: 1 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',
  installSize: 23_000_000, // ~23 MB all-MiniLM-L6-v2
  installGroup: 'nlp-standard',
  requires: { webgpu: 'preferred' },

  defaults: defaultTextEmbedParams,
  Component: TextEmbedComponentStub,

  async run(inputs: File[], _params: TextEmbedParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length < 1) {
      throw new Error('text-embed requires at least one text file.');
    }

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading embedding model' });

    const pipe = await getPipeline(ctx, 'feature-extraction', MODEL_ID, {
      dtype: 'q8',
    }) as (input: string, options?: Record<string, unknown>) => Promise<{ data: Float32Array | number[] }>;

    if (ctx.signal.aborted) throw new Error('Aborted');

    const embeddings: number[][] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      ctx.onProgress({
        stage: 'processing',
        percent: Math.round(10 + (i / inputs.length) * 70),
        message: `Embedding text ${i + 1} of ${inputs.length}`,
      });

      const text = await inputs[i]!.text();
      const result = await pipe(text.trim(), { pooling: 'mean', normalize: true });
      embeddings.push(Array.from(result.data));
    }

    ctx.onProgress({ stage: 'processing', percent: 85, message: 'Computing pairwise similarities' });

    // Only compute pairwise if N <= 50 to avoid O(N²) explosion
    const pairwise: Array<{ a: number; b: number; cosine: number }> = [];
    if (inputs.length <= 50) {
      for (let a = 0; a < embeddings.length; a++) {
        for (let b = a + 1; b < embeddings.length; b++) {
          const cosine = cosineSimilarity(embeddings[a]!, embeddings[b]!);
          pairwise.push({ a, b, cosine: Math.round(cosine * 10000) / 10000 });
        }
      }
    }

    const result: TextEmbedResult = { embeddings, pairwise };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: ['sample.txt', 'sample.txt'],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
