import { describe, it, expect } from 'vitest';
import { runDefaultChain } from '../../src/chain/run-default.js';
import type { ToolRunContext } from '../../src/types.js';
import { loadFixture } from '../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'chain-test',
  };
}

describe('chain integration — real tool chains', () => {
  it('runs compress → strip-exif on an image', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const chain = [
      { toolId: 'compress', params: { quality: 60 } },
      { toolId: 'strip-exif', params: {} },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');
    expect(outputs[0]!.size).toBeGreaterThan(0);
  });

  it('runs convert → compress to transform format and shrink', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const chain = [
      { toolId: 'convert', params: { targetFormat: 'webp', quality: 80 } },
      { toolId: 'compress', params: { quality: 50 } },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/webp');
  });

  it('throws ChainError when step references unknown tool', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const chain = [
      { toolId: 'compress', params: {} },
      { toolId: 'nonexistent-tool', params: {} },
    ];
    await expect(runDefaultChain(chain, [input], makeCtx())).rejects.toThrow(/unknown tool/i);
  });

  it('throws ChainError on type incompatibility', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    // merge-pdf expects PDFs, not JPEGs
    const chain = [
      { toolId: 'compress', params: {} },
      { toolId: 'merge-pdf', params: {} },
    ];
    await expect(runDefaultChain(chain, [input], makeCtx())).rejects.toThrow(/expects/i);
  });

  it('reports progress across multiple chained steps', async () => {
    const events: Array<{ stage: string }> = [];
    const ctx: ToolRunContext = {
      onProgress: (p) => events.push({ stage: p.stage }),
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'chain-progress',
    };
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const chain = [
      { toolId: 'compress', params: {} },
      { toolId: 'strip-exif', params: {} },
    ];
    await runDefaultChain(chain, [input], ctx);
    // Each step reports at least 'processing' and 'done'. Chain of 2 steps = 2+ done events.
    const doneEvents = events.filter((e) => e.stage === 'done');
    expect(doneEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('runs a 3-step chain: convert → strip-exif → compress', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const chain = [
      { toolId: 'convert', params: { targetFormat: 'jpeg', quality: 90 } },
      { toolId: 'strip-exif', params: {} },
      { toolId: 'compress', params: { quality: 50 } },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');
  });
});
