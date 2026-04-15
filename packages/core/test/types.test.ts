import { describe, it, expect } from 'vitest';
import type {
  ToolModule,
  ToolCategory,
  ToolPresence,
  ToolInputSpec,
  ToolOutputSpec,
  ToolProgress,
  ToolRunContext,
  MemoryEstimate,
  MimePattern,
} from '../src/types.js';

describe('types', () => {
  it('ToolCategory includes expected values', () => {
    const cat: ToolCategory = 'optimize';
    expect(cat).toBe('optimize');
  });

  it('MemoryEstimate includes expected tiers', () => {
    const mem: MemoryEstimate = 'low';
    expect(mem).toBe('low');
  });

  it('ToolPresence is a union of three literals', () => {
    const p: ToolPresence = 'editor';
    expect(p).toBe('editor');
  });

  it('ToolRunContext has executionId for idempotency', () => {
    const ctx: ToolRunContext = {
      onProgress: () => {},
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'test-uuid',
    };
    expect(ctx.executionId).toBe('test-uuid');
  });

  it('ToolModule interface compiles with a minimal shape', () => {
    const mod: ToolModule<{ quality: number }> = {
      id: 'test',
      slug: 'test',
      name: 'Test',
      description: 'Test tool',
      category: 'optimize',
      presence: 'both',
      keywords: ['test'],
      input: { accept: ['image/*'], min: 1 },
      output: { mime: 'image/png' },
      interactive: false,
      batchable: true,
      cost: 'free',
      memoryEstimate: 'low',
      defaults: { quality: 80 },
      Component: (() => null) as any,
      run: async () => new Blob(),
      __testFixtures: { valid: [], weird: [], expectedOutputMime: [] },
    };
    expect(mod.id).toBe('test');
    expect(mod.memoryEstimate).toBe('low');
  });
});
