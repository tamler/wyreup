import type { ToolRunContext } from '../types.js';
import type { ToolRegistry } from '../registry.js';
import { mimeMatches } from '../registry.js';
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
): Promise<Blob[]> {
  if (depth >= MAX_CHAIN_DEPTH) {
    throw new ChainError(
      `Maximum chain depth ${MAX_CHAIN_DEPTH} exceeded`,
      depth,
    );
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

    // Type compatibility check: every input file must match one of the tool's accepted MIME patterns.
    // Skip if tool accepts min:0 and we have no inputs (e.g. qr generator).
    if (currentInputs.length > 0) {
      for (const file of currentInputs) {
        const accepted = tool.input.accept.some((p) => mimeMatches(file.type, p));
        if (!accepted) {
          throw new ChainError(
            `Step ${i + 1} (${tool.id}) expects ${tool.input.accept.join(', ')} but got ${currentInputs.map((f) => f.type).join(', ')}`,
            i,
          );
        }
      }
    }

    const params = { ...(tool.defaults as Record<string, unknown>), ...step.params };

    const result = await tool.run(currentInputs, params, ctx);
    const blobs: Blob[] = Array.isArray(result) ? result : [result];

    // Wrap blobs as File objects for the next step, preserving input filenames where possible.
    currentInputs = blobs.map((blob, j) => {
      const name = currentInputs[j]?.name ?? `step-${i}-${j}`;
      return new File([blob], name, { type: blob.type });
    });
  }

  // Return the raw blobs from the last step (not the File wrappers).
  return currentInputs.map((f) => new Blob([f], { type: f.type }));
}
