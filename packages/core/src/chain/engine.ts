import type { ToolRunContext } from '../types.js';
import type { Chain, ChainStep } from './types.js';
import { ChainError } from './errors.js';

// Re-export for ergonomics.
export { ChainError };
export type { Chain, ChainStep };

/**
 * Hard cap on chain nesting depth. Prevents runaway recursion (user chains
 * referencing other user chains) from freezing the browser.
 */
export const MAX_CHAIN_DEPTH = 10;

/**
 * Execute a chain of tools in sequence. Each step's output feeds the next
 * step's input. Wave 0 skeleton: validates depth, iterates steps, delegates
 * actual tool lookup/execution to the registry (added in Wave 1).
 *
 * @param chain      The ordered list of steps to run.
 * @param inputs     Initial inputs for the first step.
 * @param ctx        Run context (progress, abort, executionId, etc.).
 * @param depth      Current recursion depth (defaults to 0; incremented by
 *                   callers that invoke runChain from within runChain).
 */
export async function runChain(
  chain: Chain,
  inputs: File[],
  ctx: ToolRunContext,
  depth = 0,
): Promise<Blob[]> {
  if (depth >= MAX_CHAIN_DEPTH) {
    throw new ChainError(
      `Maximum chain depth ${MAX_CHAIN_DEPTH} exceeded`,
      depth,
    );
  }

  // Wave 0 skeleton: no registry yet, so we can only iterate the chain.
  // Wave 1 will fill in the step-execution body that looks up tools and runs them.

  for (let i = 0; i < chain.length; i++) {
    if (ctx.signal.aborted) {
      throw new ChainError('Aborted', i);
    }
    // Skeleton: no actual execution. Wave 1 implements step dispatch.
    const _step: ChainStep = chain[i]!;
    void _step;
    void inputs;
  }

  // Wave 0 returns empty; Wave 1 returns actual output blobs.
  return [];
}
