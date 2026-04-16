import { describe, it, expect } from 'vitest';
import { runDefaultChain } from '../../src/chain/run-default.js';
import type { ToolRunContext } from '../../src/types.js';
import { loadFixture } from '../lib/load-fixture.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'wave-1e-chain',
  };
}

describe('wave 1e chain demos', () => {
  it('rotate-image → sepia → compress on a photo', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const chain = [
      { toolId: 'rotate-image', params: { degrees: 90 } },
      { toolId: 'sepia', params: {} },
      { toolId: 'compress', params: { quality: 70 } },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs.length).toBe(1);
    expect(outputs[0]!.type).toBe('image/jpeg');
  });

  it('grayscale → invert → compress inverts lightness', async () => {
    const input = loadFixture('photo.jpg', 'image/jpeg');
    const chain = [
      { toolId: 'grayscale', params: {} },
      { toolId: 'invert', params: {} },
      { toolId: 'compress', params: { quality: 80 } },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs.length).toBe(1);
  });

  it('flip-image → strip-exif preserves format', async () => {
    const input = loadFixture('graphic.png', 'image/png');
    const chain = [
      { toolId: 'flip-image', params: { direction: 'vertical' } },
      { toolId: 'strip-exif', params: {} },
    ];
    const outputs = await runDefaultChain(chain, [input], makeCtx());
    expect(outputs[0]!.type).toBe('image/png');
  });
});
