import { describe, it, expect } from 'vitest';
import {
  runChain,
  MAX_CHAIN_DEPTH,
  ChainError,
  type Chain,
  type ChainStep,
} from '../../src/chain/engine.js';
import { createRegistry } from '../../src/registry.js';
import type { ToolRunContext } from '../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test-exec-id',
  };
}

const emptyRegistry = createRegistry([]);

describe('runChain', () => {
  it('throws ChainError with depth info when MAX_CHAIN_DEPTH exceeded', async () => {
    const step: ChainStep = { toolId: 'nonexistent-tool', params: {} };
    const chain: Chain = Array<ChainStep>(MAX_CHAIN_DEPTH + 1).fill(step);

    await expect(runChain(chain, [], makeCtx(), emptyRegistry, MAX_CHAIN_DEPTH + 1))
      .rejects.toBeInstanceOf(ChainError);
  });

  it('MAX_CHAIN_DEPTH is exactly 10', () => {
    expect(MAX_CHAIN_DEPTH).toBe(10);
  });

  it('returns empty array when given empty chain', async () => {
    const result = await runChain([], [], makeCtx(), emptyRegistry);
    expect(result).toEqual([]);
  });

  it('ChainError carries the failing step index', () => {
    const err = new ChainError('test', 3);
    expect(err.stepIndex).toBe(3);
    expect(err.message).toBe('test');
    expect(err).toBeInstanceOf(Error);
  });
});
