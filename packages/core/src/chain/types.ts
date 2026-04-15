/**
 * One step in a chain: a tool id plus partial parameters that override defaults.
 */
export interface ChainStep {
  toolId: string;
  params: Record<string, unknown>;
}

/**
 * A chain is an ordered list of steps. Each step's output feeds the next step's input.
 */
export type Chain = ChainStep[];

/**
 * A saved chain that can be invoked by name and converted to a ToolModule
 * via the chainToToolModule adapter (Wave 1).
 */
export interface SavedChain {
  id: string;
  name: string;
  description?: string;
  steps: Chain;
  createdAt: number;
}
