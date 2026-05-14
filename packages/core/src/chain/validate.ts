// Chain validation — guard against unknown / spoofed tool IDs.
//
// Tool definitions are compiled into @wyreup/core and shipped via signed
// npm publish, so the registry cannot be extended at runtime. But chains
// stored in localStorage, imported from JSON, or arriving via shared URLs
// can reference IDs that aren't in the active registry. Today that fails
// at runChain() time with an opaque error; this helper catches it at
// save / import / preview time so the user sees a clear "unknown tool"
// message BEFORE they confirm.
//
// See docs/triggers-security.md — the spoofing concern motivating this.

import type { Chain } from './engine.js';
import type { ToolRegistry } from '../registry.js';

export interface ChainValidationResult {
  ok: boolean;
  /** Tool IDs in the chain that aren't in the registry. */
  unknownTools: string[];
  /** Step indices (0-based) that reference an unknown tool. */
  unknownStepIndices: number[];
}

export function validateChain(chain: Chain, registry: ToolRegistry): ChainValidationResult {
  const unknownTools: string[] = [];
  const unknownStepIndices: number[] = [];
  const seenUnknown = new Set<string>();

  chain.forEach((step, i) => {
    if (!registry.toolsById.has(step.toolId)) {
      unknownStepIndices.push(i);
      if (!seenUnknown.has(step.toolId)) {
        unknownTools.push(step.toolId);
        seenUnknown.add(step.toolId);
      }
    }
  });

  return {
    ok: unknownTools.length === 0,
    unknownTools,
    unknownStepIndices,
  };
}
