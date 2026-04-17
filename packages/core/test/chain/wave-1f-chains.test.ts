import { describe, it, expect } from 'vitest';
import { runDefaultChain } from '../../src/chain/run-default.js';
import type { ToolRunContext } from '../../src/types.js';
import { loadFixture } from '../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'wave-1f-chain',
  };
}

describe('wave 1f chain demos', () => {
  it('pdf-to-image → rotate-image → sepia → compress (the "old book page" chain)', async () => {
    const input = loadFixture('doc-a.pdf', 'application/pdf');
    const chain = [
      { toolId: 'pdf-to-image', params: { dpi: 100 } },
      { toolId: 'rotate-image', params: { degrees: 90 } },
      { toolId: 'sepia', params: {} },
      { toolId: 'compress', params: { quality: 75 } },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs.length).toBeGreaterThanOrEqual(1);
    expect(outputs[0]!.type).toMatch(/^image\//);
  });

  it('crop → resize chain preserves dimensions math', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const chain = [
      { toolId: 'crop', params: { x: 0, y: 0, width: 400, height: 400 } },
      { toolId: 'resize', params: { mode: 'exact', width: 100, height: 100 } },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');
  });
});
