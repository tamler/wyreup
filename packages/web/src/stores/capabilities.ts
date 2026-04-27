/**
 * Browser-side capability detection cached as a Svelte store. Resolves once
 * per page load (the WebGPU adapter probe + memory hint), then every consumer
 * reuses the same value.
 *
 * Used to hide tools that genuinely can't run on the current device from
 * listings (the /tools grid, header search, /chain/build picker). Direct
 * URLs like /tools/bg-remove always resolve so chain navigation doesn't
 * silently break — the tool page itself surfaces a "this device can't run
 * this" notice.
 */
import { writable, type Readable, derived } from 'svelte/store';
import {
  detectCapabilities,
  checkToolCapabilities,
  type Capabilities,
  type ToolRequires,
} from '@wyreup/core';

interface CapState {
  ready: boolean;
  caps: Capabilities;
}

// Conservative defaults until the probe finishes — assume capable so we
// don't flicker-hide tools on first paint, then re-filter once we know.
const DEFAULTS: Capabilities = {
  hasWebGPU: true,
  hasWasm: true,
  deviceMemoryGB: 8,
};

const state = writable<CapState>({ ready: false, caps: DEFAULTS });

if (typeof window !== 'undefined') {
  void (async () => {
    try {
      const caps = await detectCapabilities();
      state.set({ ready: true, caps });
    } catch {
      // Fall back to assuming-capable. Better than hiding everything on
      // an unexpected error.
      state.set({ ready: true, caps: DEFAULTS });
    }
  })();
}

export const capabilities: Readable<CapState> = { subscribe: state.subscribe };

/**
 * "Show tools my device can't run anyway" — user-controllable override.
 * Persists to localStorage so the choice sticks across visits.
 */
const STORAGE_KEY = 'wyreup:show-unrunnable-tools';

function readOverride(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const _override = writable<boolean>(readOverride());

_override.subscribe((v) => {
  if (typeof localStorage === 'undefined') return;
  try {
    if (v) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
});

export const showUnrunnable = _override;

/**
 * Filter a list of tools (must have an `id` and optional `requires` field)
 * down to ones the current device can run. When `showUnrunnable` is true,
 * returns the input unchanged.
 */
export function filterRunnable<T extends { requires?: ToolRequires }>(
  tools: T[],
  caps: Capabilities,
  showAll: boolean,
): { runnable: T[]; hiddenCount: number } {
  if (showAll) return { runnable: tools, hiddenCount: 0 };
  const runnable: T[] = [];
  let hiddenCount = 0;
  for (const t of tools) {
    const check = checkToolCapabilities(t, caps);
    if (check.runnable) runnable.push(t);
    else hiddenCount += 1;
  }
  return { runnable, hiddenCount };
}

/**
 * Convenience derived store — emits the live filter result for a given list.
 * Re-runs whenever capabilities resolve or the user flips the override.
 */
export function makeRunnableStore<T extends { requires?: ToolRequires }>(
  tools: T[],
): Readable<{ runnable: T[]; hiddenCount: number; ready: boolean }> {
  return derived([capabilities, showUnrunnable], ([$caps, $show]) => {
    const { runnable, hiddenCount } = filterRunnable(tools, $caps.caps, $show);
    return { runnable, hiddenCount, ready: $caps.ready };
  });
}
