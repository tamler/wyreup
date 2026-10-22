import { describe, expect, it, vi } from 'vitest';
import * as root from '../src/index.js';
import * as execution from '../src/execution.js';
import { getPipeline } from '../src/lib/transformers.js';
import type { ToolRunContext } from '../src/types.js';

vi.mock('@huggingface/transformers', () => ({
  env: { remoteHost: 'https://huggingface.co/' },
  pipeline: vi.fn(() => Promise.resolve({ dispose: vi.fn() })),
}));

describe('execution entry shares the original public API owners', () => {
  it('exposes exactly 65 existing runtime bindings with identical references', () => {
    const bindings = Object.entries(execution);
    expect(bindings).toHaveLength(65);
    for (const [name, binding] of bindings) {
      expect(binding, name).toBe(root[name as keyof typeof root]);
    }
  });

  it('uses the same registry catalogue and input definitions', () => {
    const original = root.createDefaultRegistry();
    const routed = execution.createDefaultRegistry();
    expect(routed.tools.map((tool) => tool.id)).toEqual(original.tools.map((tool) => tool.id));
    for (const tool of routed.tools) {
      expect(tool.input).toBe(original.toolsById.get(tool.id)?.input);
    }
  });

  it('updates the same model CDN state', () => {
    const previous = root.getModelCdn();
    try {
      execution.setModelCdn('https://models.example.test/');
      expect(root.getModelCdn()).toBe('https://models.example.test');
      expect(root.modelUrl('model.bin', 'https://upstream.example.test/model.bin')).toBe(
        'https://models.example.test/model.bin',
      );
    } finally {
      root.setModelCdn(previous);
    }
  });

  it('clears the original pipeline cache through either entry', async () => {
    const ctx: ToolRunContext = {
      onProgress: () => {},
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'execution-entry-identity',
    };
    root.clearPipelineCache();
    try {
      const first = await getPipeline(ctx, 'sentiment-analysis', 'test/execution-entry');
      expect(await getPipeline(ctx, 'sentiment-analysis', 'test/execution-entry')).toBe(first);
      execution.clearPipelineCache();
      expect(await getPipeline(ctx, 'sentiment-analysis', 'test/execution-entry')).not.toBe(first);
    } finally {
      root.clearPipelineCache();
    }
  });
});
