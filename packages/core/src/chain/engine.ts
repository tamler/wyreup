import type { ToolRunContext } from '../types.js';
import type { ToolRegistry } from '../registry.js';
import type { Chain, ChainStep } from './types.js';
import { ChainError } from './errors.js';
import { validateToolInputs } from '../lib/input-validation.js';

// Re-export for ergonomics.
export { ChainError };
export type { Chain, ChainStep };

export interface ChainRunHooks {
  onStepComplete?(event: {
    index: number;
    step: ChainStep;
    outputs: readonly File[];
  }): void | Promise<void>;
}

/**
 * Hard cap on chain nesting depth. Prevents runaway recursion (user chains
 * referencing other user chains) from freezing the browser.
 */
export const MAX_CHAIN_DEPTH = 10;

/**
 * Execute a chain of tools in sequence. Each step's output feeds the next
 * step's input.
 *
 * @param chain      The ordered list of steps to run.
 * @param inputs     Initial inputs for the first step.
 * @param ctx        Run context (progress, abort, executionId, etc.).
 * @param registry   Tool registry to look up steps by toolId.
 * @param depth      Current recursion depth (defaults to 0).
 */
export async function runChain(
  chain: Chain,
  inputs: File[],
  ctx: ToolRunContext,
  registry: ToolRegistry,
  depth = 0,
  hooks: ChainRunHooks = {},
): Promise<Blob[]> {
  if (depth >= MAX_CHAIN_DEPTH) {
    throw new ChainError(`Maximum chain depth ${MAX_CHAIN_DEPTH} exceeded`, depth);
  }

  if (chain.length === 0) {
    return [];
  }

  let currentInputs: File[] = inputs;

  for (let i = 0; i < chain.length; i++) {
    if (ctx.signal.aborted) {
      throw new ChainError('Aborted', i);
    }

    const step = chain[i]!;

    const tool = registry.toolsById.get(step.toolId);
    if (tool === undefined) {
      throw new ChainError(`Unknown tool: ${step.toolId}`, i);
    }

    if (currentInputs.length < tool.input.min) {
      throw new ChainError(
        `Step ${i + 1} (${tool.id}) expects at least ${tool.input.min} file${tool.input.min === 1 ? '' : 's'} but got ${currentInputs.length}`,
        i,
      );
    }

    // A one-file consumer can safely fan out across a producer's multiple
    // outputs. Higher-cardinality tools have semantic grouping requirements
    // (pairs, ordered sequences, etc.), so reject overflow instead of guessing.
    const shouldFanOut = tool.input.max === 1 && currentInputs.length > 1;
    if (shouldFanOut && tool.cost === 'credit') {
      throw new ChainError(
        `Step ${i + 1} (${tool.id}) would run a paid tool ${currentInputs.length} times. Run each file explicitly so every charge is intentional.`,
        i,
      );
    }
    if (tool.input.max !== undefined && currentInputs.length > tool.input.max && !shouldFanOut) {
      throw new ChainError(
        `Step ${i + 1} (${tool.id}) accepts at most ${tool.input.max} file${tool.input.max === 1 ? '' : 's'} but got ${currentInputs.length}`,
        i,
      );
    }

    const params = { ...(tool.defaults as Record<string, unknown>), ...step.params };

    const batches = shouldFanOut ? currentInputs.map((file) => [file]) : [currentInputs];
    const nextInputs: File[] = [];

    for (const batch of batches) {
      if (ctx.signal.aborted) {
        throw new ChainError('Aborted', i);
      }
      const validationError = validateToolInputs(batch, tool.input);
      if (validationError) {
        throw new ChainError(`Step ${i + 1} (${tool.id}) ${validationError}`, i);
      }
      const result = await tool.run(batch, params, ctx);
      const blobs: Blob[] = Array.isArray(result) ? result : [result];

      // Wrap blobs as File objects for the next step, preserving filenames
      // within each invocation where possible.
      for (let j = 0; j < blobs.length; j++) {
        const blob = blobs[j]!;
        const name =
          batch[j]?.name ??
          (j === 0 ? batch[0]?.name : undefined) ??
          `step-${i}-${nextInputs.length}`;
        nextInputs.push(new File([blob], name, { type: blob.type }));
      }
    }

    currentInputs = nextInputs;
    await hooks.onStepComplete?.({ index: i, step, outputs: currentInputs });
  }

  // Return the raw blobs from the last step (not the File wrappers).
  return currentInputs.map((f) => new Blob([f], { type: f.type }));
}
