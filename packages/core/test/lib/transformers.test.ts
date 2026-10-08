import { describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '../../src/types.js';

const { pipelineMock } = vi.hoisted(() => ({
  pipelineMock: vi.fn(() => Promise.resolve({ dispose: vi.fn() })),
}));

vi.mock('@huggingface/transformers', () => ({
  env: { remoteHost: 'https://huggingface.co/', remotePathTemplate: '{model}/resolve/{revision}/' },
  pipeline: pipelineMock,
}));

import { DEFAULT_PIPELINE_DTYPE, getPipeline } from '../../src/lib/transformers.js';

const ctx = { onProgress: vi.fn() } as unknown as ToolRunContext;

describe('Transformers.js model selection', () => {
  it('requests the same q8 assets in browsers, CLI and MCP', async () => {
    expect(DEFAULT_PIPELINE_DTYPE).toBe('q8');
    await getPipeline(ctx, 'sentiment-analysis', 'test/default-dtype');
    expect(pipelineMock).toHaveBeenLastCalledWith(
      'sentiment-analysis', 'test/default-dtype', expect.objectContaining({ dtype: 'q8' }),
    );
  });

  it('preserves explicit tool dtype selection', async () => {
    await getPipeline(ctx, 'image-segmentation', 'test/explicit-dtype', { dtype: 'fp16' });
    expect(pipelineMock).toHaveBeenLastCalledWith(
      'image-segmentation', 'test/explicit-dtype', expect.objectContaining({ dtype: 'fp16' }),
    );
  });
});
