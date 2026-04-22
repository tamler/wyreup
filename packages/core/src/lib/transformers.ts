/**
 * Transformers.js v4 pipeline singleton loader.
 *
 * Cache is module-level so pipelines survive multiple tool invocations within
 * the same JS module instance (i.e. the same browser tab or Node process).
 * ctx.cache is per-invocation; pipeline loading is expensive (downloads model
 * weights on first use), so we cache across invocations here.
 */
import type { ToolRunContext } from '../types.js';

const pipelineCache: Map<string, unknown> = new Map();

/**
 * Load (or return cached) a Transformers.js v4 pipeline.
 * Key is `${task}:${model}` so the same pipeline is reused across tool
 * invocations in the same session.
 *
 * @param ctx   - Tool run context, used for progress reporting during model download.
 * @param task  - Transformers.js pipeline task name (e.g. 'sentiment-analysis').
 * @param model - HuggingFace model ID (e.g. 'Xenova/distilbert-base-uncased-finetuned-sst-2-english').
 * @param options - Additional pipeline options forwarded to the pipeline() constructor.
 */
export async function getPipeline(
  ctx: ToolRunContext,
  task: string,
  model: string,
  options: Record<string, unknown> = {},
): Promise<unknown> {
  const key = `${task}:${model}`;
  const cached = pipelineCache.get(key);
  if (cached) return cached;

  const { pipeline } = await import('@huggingface/transformers');

  const pipe = await pipeline(task as Parameters<typeof pipeline>[0], model, {
    ...options,
    // Progress callback receives an untyped object from the Transformers.js library.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progress_callback: (p: any) => {
      /* eslint-disable @typescript-eslint/no-unsafe-member-access */
      if (p.status === 'downloading' && p.total) {
        const percent =
          p.loaded != null && p.total ? (p.loaded / p.total) * 100 : undefined;
        ctx.onProgress({
          stage: 'loading-deps',
          percent,
          message: `Downloading ${model}...`,
        });
      }
      /* eslint-enable @typescript-eslint/no-unsafe-member-access */
    },
  } as Parameters<typeof pipeline>[2]);

  pipelineCache.set(key, pipe);
  return pipe;
}
