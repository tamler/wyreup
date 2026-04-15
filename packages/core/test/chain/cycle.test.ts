import { describe, it, expect } from 'vitest';
import { detectCycle } from '../../src/chain/cycle.js';
import type { SavedChain } from '../../src/chain/types.js';

describe('detectCycle', () => {
  it('returns null for a chain with no user-chain references', () => {
    const chain: SavedChain = {
      id: 'a',
      name: 'A',
      steps: [
        { toolId: 'compress', params: {} },
        { toolId: 'strip-exif', params: {} },
      ],
      createdAt: 0,
    };
    const allChains = new Map([['a', chain]]);
    expect(detectCycle(chain, allChains)).toBeNull();
  });

  it('returns null when referenced user chains do not form a cycle', () => {
    const chainB: SavedChain = {
      id: 'b',
      name: 'B',
      steps: [{ toolId: 'compress', params: {} }],
      createdAt: 0,
    };
    const chainA: SavedChain = {
      id: 'a',
      name: 'A',
      steps: [{ toolId: 'user:b', params: {} }],
      createdAt: 0,
    };
    const allChains = new Map([
      ['a', chainA],
      ['b', chainB],
    ]);
    expect(detectCycle(chainA, allChains)).toBeNull();
  });

  it('detects direct self-reference (A → A)', () => {
    const chainA: SavedChain = {
      id: 'a',
      name: 'A',
      steps: [{ toolId: 'user:a', params: {} }],
      createdAt: 0,
    };
    const allChains = new Map([['a', chainA]]);
    const cycle = detectCycle(chainA, allChains);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain('a');
  });

  it('detects indirect cycle (A → B → A)', () => {
    const chainA: SavedChain = {
      id: 'a',
      name: 'A',
      steps: [{ toolId: 'user:b', params: {} }],
      createdAt: 0,
    };
    const chainB: SavedChain = {
      id: 'b',
      name: 'B',
      steps: [{ toolId: 'user:a', params: {} }],
      createdAt: 0,
    };
    const allChains = new Map([
      ['a', chainA],
      ['b', chainB],
    ]);
    const cycle = detectCycle(chainA, allChains);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain('a');
    expect(cycle).toContain('b');
  });

  it('detects longer cycle (A → B → C → A)', () => {
    const chainA: SavedChain = {
      id: 'a',
      name: 'A',
      steps: [{ toolId: 'user:b', params: {} }],
      createdAt: 0,
    };
    const chainB: SavedChain = {
      id: 'b',
      name: 'B',
      steps: [{ toolId: 'user:c', params: {} }],
      createdAt: 0,
    };
    const chainC: SavedChain = {
      id: 'c',
      name: 'C',
      steps: [{ toolId: 'user:a', params: {} }],
      createdAt: 0,
    };
    const allChains = new Map([
      ['a', chainA],
      ['b', chainB],
      ['c', chainC],
    ]);
    const cycle = detectCycle(chainA, allChains);
    expect(cycle).not.toBeNull();
    expect(cycle).toEqual(['a', 'b', 'c', 'a']);
  });
});
