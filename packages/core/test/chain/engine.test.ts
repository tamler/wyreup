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
import type { ToolModule } from '../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test-exec-id',
  };
}

const emptyRegistry = createRegistry([]);

function makeTool(overrides: Partial<ToolModule> & Pick<ToolModule, 'id'>): ToolModule {
  return {
    slug: overrides.id,
    name: overrides.id,
    description: 'Test tool.',
    category: 'text',
    keywords: [],
    input: { accept: ['text/plain'], min: 1, max: 1 },
    output: { mime: 'text/plain' },
    interactive: false,
    batchable: false,
    cost: 'free',
    memoryEstimate: 'low',
    defaults: {},
    __testFixtures: { valid: [], weird: [], expectedOutputMime: [] },
    run: () => Promise.resolve(new Blob(['output'], { type: 'text/plain' })),
    ...overrides,
  };
}

describe('runChain', () => {
  it('throws ChainError with depth info when MAX_CHAIN_DEPTH exceeded', async () => {
    const step: ChainStep = { toolId: 'nonexistent-tool', params: {} };
    const chain: Chain = Array<ChainStep>(MAX_CHAIN_DEPTH + 1).fill(step);

    await expect(
      runChain(chain, [], makeCtx(), emptyRegistry, MAX_CHAIN_DEPTH + 1),
    ).rejects.toBeInstanceOf(ChainError);
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

  it('fans multiple outputs out through a single-file consumer', async () => {
    const producer: ToolModule = {
      id: 'producer',
      slug: 'producer',
      name: 'Producer',
      description: 'Produces two files.',
      category: 'create',
      keywords: [],
      input: { accept: [], min: 0, max: 0 },
      output: { mime: 'text/plain', multiple: true },
      interactive: false,
      batchable: false,
      cost: 'free',
      memoryEstimate: 'low',
      defaults: {},
      __testFixtures: { valid: [], weird: [], expectedOutputMime: [] },
      run: () =>
        Promise.resolve([
          new Blob(['one'], { type: 'text/plain' }),
          new Blob(['two'], { type: 'text/plain' }),
        ]),
    };
    const seen: string[] = [];
    const consumer: ToolModule = {
      ...producer,
      id: 'consumer',
      slug: 'consumer',
      name: 'Consumer',
      input: { accept: ['text/plain'], min: 1, max: 1 },
      output: { mime: 'text/plain' },
      run: async (inputs) => {
        seen.push(await inputs[0]!.text());
        return new Blob([`seen:${seen.at(-1)}`], { type: 'text/plain' });
      },
    };
    const registry = createRegistry([producer, consumer]);

    const completedSteps: string[][] = [];
    const outputs = await runChain(
      [
        { toolId: 'producer', params: {} },
        { toolId: 'consumer', params: {} },
      ],
      [],
      makeCtx(),
      registry,
      0,
      {
        onStepComplete: async ({ outputs }) => {
          completedSteps.push(await Promise.all(outputs.map((output) => output.text())));
        },
      },
    );

    expect(seen).toEqual(['one', 'two']);
    expect(completedSteps).toEqual([
      ['one', 'two'],
      ['seen:one', 'seen:two'],
    ]);
    await expect(Promise.all(outputs.map((output) => output.text()))).resolves.toEqual([
      'seen:one',
      'seen:two',
    ]);
  });

  it('refuses to fan multiple outputs out through a paid tool', async () => {
    const producer = makeTool({
      id: 'producer',
      input: { accept: [], min: 0, max: 0 },
      output: { mime: 'text/plain', multiple: true },
      run: () =>
        Promise.resolve([
          new Blob(['one'], { type: 'text/plain' }),
          new Blob(['two'], { type: 'text/plain' }),
        ]),
    });
    const paidConsumer = makeTool({
      id: 'paid-consumer',
      cost: 'credit',
      input: { accept: ['text/plain'], min: 1, max: 1 },
    });

    await expect(
      runChain(
        [
          { toolId: producer.id, params: {} },
          { toolId: paidConsumer.id, params: {} },
        ],
        [],
        makeCtx(),
        createRegistry([producer, paidConsumer]),
      ),
    ).rejects.toThrow('every charge is intentional');
  });

  it('rejects a step when too few inputs are available', async () => {
    const consumer: ToolModule = {
      id: 'pair-consumer',
      slug: 'pair-consumer',
      name: 'Pair consumer',
      description: 'Needs two files.',
      category: 'text',
      keywords: [],
      input: { accept: ['text/plain'], min: 2, max: 2 },
      output: { mime: 'text/plain' },
      interactive: false,
      batchable: false,
      cost: 'free',
      memoryEstimate: 'low',
      defaults: {},
      __testFixtures: { valid: [], weird: [], expectedOutputMime: [] },
      run: () => Promise.resolve(new Blob(['unexpected'], { type: 'text/plain' })),
    };

    await expect(
      runChain(
        [{ toolId: consumer.id, params: {} }],
        [new File(['one'], 'one.txt', { type: 'text/plain' })],
        makeCtx(),
        createRegistry([consumer]),
      ),
    ).rejects.toThrow(/at least 2 files/i);
  });
});
