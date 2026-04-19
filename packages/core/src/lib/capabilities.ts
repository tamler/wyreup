import type { ToolRequires } from '../types.js';

export interface Capabilities {
  hasWebGPU: boolean;
  hasWasm: boolean;
  deviceMemoryGB: number;
}

/**
 * Detect runtime capabilities of the current environment.
 * Safe to call in Node (returns conservative defaults) and browser.
 * Result should be cached at app startup — repeated calls re-query the GPU adapter.
 */
export async function detectCapabilities(): Promise<Capabilities> {
  const hasWasm = typeof WebAssembly !== 'undefined';
  const isBrowser = typeof navigator !== 'undefined';

  if (!isBrowser) {
    return { hasWebGPU: false, hasWasm, deviceMemoryGB: 8 };
  }

  let hasWebGPU = 'gpu' in navigator;
  if (hasWebGPU) {
    try {
      const gpu = (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu;
      const adapter = await gpu.requestAdapter();
      hasWebGPU = !!adapter;
    } catch {
      hasWebGPU = false;
    }
  }

  const deviceMemoryGB = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;

  return { hasWebGPU, hasWasm, deviceMemoryGB };
}

export interface CapabilityCheck {
  /** True if the tool can be invoked in the current environment. */
  runnable: boolean;
  /** When runnable is false, a user-readable reason. */
  reason?: string;
  /** When runnable is true, true iff the tool will run slower than its best mode. */
  slower?: boolean;
}

/**
 * Decide whether a tool can run given current capabilities, and whether it will be degraded.
 * - No `requires` -> always runnable.
 * - `webgpu: 'required'` -> runnable only if WebGPU is present.
 * - `webgpu: 'preferred'` -> always runnable; `slower` is true when WebGPU is absent.
 * - `minMemoryGB` -> blocks when reported device memory is below threshold.
 */
export function checkToolCapabilities(
  tool: { requires?: ToolRequires },
  capabilities: Capabilities,
): CapabilityCheck {
  const req = tool.requires;
  if (!req) return { runnable: true };

  if (req.webgpu === 'required' && !capabilities.hasWebGPU) {
    return {
      runnable: false,
      reason: 'This tool needs WebGPU. Run it locally with the Wyreup CLI.',
    };
  }

  if (req.minMemoryGB && capabilities.deviceMemoryGB < req.minMemoryGB) {
    return {
      runnable: false,
      reason: `This tool needs at least ${req.minMemoryGB} GB of device memory.`,
    };
  }

  if (req.webgpu === 'preferred' && !capabilities.hasWebGPU) {
    return { runnable: true, slower: true };
  }

  return { runnable: true };
}
