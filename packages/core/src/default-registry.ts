import { createRegistry, type ToolRegistry } from './registry.js';
import { compress } from './tools/compress/index.js';
import type { ToolModule } from './types.js';

/**
 * All first-party Wyreup tools, in presentation order.
 * Typed as ToolModule<any>[] because each tool has its own concrete Params type;
 * the generic array type ToolModule<unknown>[] rejects concrete instantiations
 * due to function parameter contravariance on the optional runStream field.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const defaultTools: ToolModule<any>[] = [compress];

export function createDefaultRegistry(): ToolRegistry {
  return createRegistry(defaultTools);
}
