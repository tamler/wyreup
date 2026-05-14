import type { ToolModule, ToolRunContext } from '../../types.js';
import { getPipeline } from '../../lib/transformers.js';

export interface ImageSimilarityParams {
  /** Cosine similarity threshold for clustering (0-1). Default 0.85. */
  threshold?: number;
}

export const defaultImageSimilarityParams: ImageSimilarityParams = {
  threshold: 0.85,
};

export interface ImageSimilarityResult {
  images: Array<{ filename: string; index: number }>;
  pairwise: Array<{ a: number; b: number; cosine: number }>;
  clusters?: number[][];
}

// CLIP ViT-B/16 — MIT licensed, 87 MB quantized
// https://huggingface.co/Xenova/clip-vit-base-patch16
const MODEL_ID = 'Xenova/clip-vit-base-patch16';

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Compute cosine similarity between two embedding vectors.
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

/**
 * Cluster image indices by cosine similarity threshold using union-find.
 */
export function clusterByThreshold(
  embeddings: number[][],
  pairwise: Array<{ a: number; b: number; cosine: number }>,
  threshold: number,
): number[][] {
  const n = embeddings.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  }

  function union(x: number, y: number): void {
    const px = find(x);
    const py = find(y);
    if (px !== py) parent[px] = py;
  }

  for (const { a, b, cosine } of pairwise) {
    if (cosine >= threshold) union(a, b);
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  return Array.from(groups.values());
}

export const imageSimilarity: ToolModule<ImageSimilarityParams> = {
  id: 'image-similarity',
  slug: 'image-similarity',
  name: 'Image Similarity',
  description: 'Compare images and find near-duplicates using CLIP embeddings — runs on your device.',
  category: 'inspect',
  keywords: ['similarity', 'duplicate', 'compare', 'clip', 'perceptual', 'near-duplicate', 'embedding'],

  input: {
    accept: ACCEPTED_MIME_TYPES,
    min: 2,
    sizeLimit: 20 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  installSize: 87_000_000, // ~87 MB quantized CLIP ViT-B/16
  installGroup: 'image-ai',
  requires: { webgpu: 'preferred' },

  defaults: defaultImageSimilarityParams,

  async run(
    inputs: File[],
    params: ImageSimilarityParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    if (inputs.length < 2) {
      throw new Error('image-similarity requires at least 2 images to compare.');
    }

    const threshold = params.threshold ?? 0.85;

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading CLIP model' });

    const pipe = await getPipeline(ctx, 'feature-extraction', MODEL_ID, {
      dtype: 'q8',
    }) as (input: unknown, options?: Record<string, unknown>) => Promise<{ data: Float32Array | number[] }>;

    if (ctx.signal.aborted) throw new Error('Aborted');

    const embeddings: number[][] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      ctx.onProgress({
        stage: 'processing',
        percent: Math.round(10 + (i / inputs.length) * 70),
        message: `Embedding image ${i + 1} of ${inputs.length}`,
      });

      const arrayBuffer = await inputs[i]!.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: inputs[i]!.type });
      const dataUrl = await blobToDataUrl(blob);

      const result = await pipe(dataUrl, { pooling: 'mean', normalize: true });
      embeddings.push(Array.from(result.data));
    }

    ctx.onProgress({ stage: 'processing', percent: 85, message: 'Computing pairwise similarities' });

    const pairwise: Array<{ a: number; b: number; cosine: number }> = [];
    for (let a = 0; a < embeddings.length; a++) {
      for (let b = a + 1; b < embeddings.length; b++) {
        const cosine = cosineSimilarity(embeddings[a]!, embeddings[b]!);
        pairwise.push({ a, b, cosine: Math.round(cosine * 10000) / 10000 });
      }
    }

    const clusters = clusterByThreshold(embeddings, pairwise, threshold);

    const result: ImageSimilarityResult = {
      images: inputs.map((f, i) => ({ filename: f.name, index: i })),
      pairwise,
      clusters,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: ['photo.jpg', 'photo.jpg'],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  const buf = await blob.arrayBuffer();
  const b64 = Buffer.from(buf).toString('base64');
  return `data:${blob.type};base64,${b64}`;
}
