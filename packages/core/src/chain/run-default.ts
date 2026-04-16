import type { Chain } from './types.js';
import { runChain } from './engine.js';
import { createDefaultRegistry } from '../default-registry.js';
import type { ToolRunContext } from '../types.js';

/**
 * Convenience wrapper: run a chain against the default Wyreup registry.
 * Most callers will use this — pass a custom registry via runChain when
 * they need non-default tools.
 */
export async function runDefaultChain(
  chain: Chain,
  inputs: File[],
  ctx: ToolRunContext,
): Promise<Blob[]> {
  return runChain(chain, inputs, ctx, createDefaultRegistry());
}
