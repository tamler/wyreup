import { writable } from 'svelte/store';
import type { ToolModule } from '@wyreup/core';

export interface DropState {
  file: File;
  mime: string;
  compatibleTools: ToolModule[];
}

/** Shared state between HeroDrop and ScenarioGrid. Memory-only, no persistence. */
export const dropStore = writable<DropState | null>(null);
