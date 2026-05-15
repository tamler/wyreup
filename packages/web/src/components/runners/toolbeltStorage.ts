/**
 * Toolbelt — localStorage-backed saved chains. The personal collection
 * a user assembles from the /tools catalog. Schema version 1.
 */

import { createDefaultRegistry, validateChain, type Chain } from '@wyreup/core';

const TOOLBELT_KEY = 'wyreup:toolbelt:chains';
const SCHEMA_VERSION = 1;

let cachedRegistry: ReturnType<typeof createDefaultRegistry> | null = null;
function getRegistry() {
  if (!cachedRegistry) cachedRegistry = createDefaultRegistry();
  return cachedRegistry;
}

export function validateToolbeltChain(chain: ToolbeltChain): { ok: boolean; unknownTools: string[] } {
  const asChain: Chain = chain.steps.map((s) => ({ toolId: s.toolId, params: s.params }));
  const r = validateChain(asChain, getRegistry());
  return { ok: r.ok, unknownTools: r.unknownTools };
}

export interface ToolbeltChainStep {
  toolId: string;
  params: Record<string, unknown>;
}

export interface ToolbeltChain {
  id: string;
  name: string;
  steps: ToolbeltChainStep[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
  schemaVersion: number;
}

function loadAll(): ToolbeltChain[] {
  try {
    const raw = localStorage.getItem(TOOLBELT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as ToolbeltChain[];
  } catch {
    return [];
  }
}

function saveAll(chains: ToolbeltChain[]): void {
  try {
    localStorage.setItem(TOOLBELT_KEY, JSON.stringify(chains));
  } catch {
    // localStorage full or unavailable
  }
  // Notify any listening UI (e.g. SavedChainsSection on /tools) to refresh.
  // localStorage doesn't fire `storage` events for same-tab writes.
  //
  // Note: the event name kept `chains-changed` (not `toolbelt-changed`)
  // because it specifically signals "saved chains were modified" — rule
  // changes get their own `wyreup:trigger-rules-changed` event in
  // triggerStorage. Two events, two concerns, decoupled subscribers.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('wyreup:chains-changed'));
  }
}

export function getAllChains(): ToolbeltChain[] {
  return loadAll();
}

export function getChain(id: string): ToolbeltChain | undefined {
  return loadAll().find((c) => c.id === id);
}

export function saveChain(chain: Omit<ToolbeltChain, 'schemaVersion'>): void {
  const all = loadAll();
  const existing = all.findIndex((c) => c.id === chain.id);
  const withVersion: ToolbeltChain = { ...chain, schemaVersion: SCHEMA_VERSION };
  if (existing >= 0) {
    all[existing] = withVersion;
  } else {
    all.push(withVersion);
  }
  saveAll(all);
}

export function deleteChain(id: string): void {
  const all = loadAll().filter((c) => c.id !== id);
  saveAll(all);
}

export function renameChain(id: string, name: string): void {
  const all = loadAll();
  const chain = all.find((c) => c.id === id);
  if (chain) {
    chain.name = name;
    chain.updatedAt = new Date().toISOString();
    saveAll(all);
  }
}

export function duplicateChain(id: string): ToolbeltChain | null {
  const chain = getChain(id);
  if (!chain) return null;
  const now = new Date().toISOString();
  const copy: ToolbeltChain = {
    ...chain,
    id: crypto.randomUUID(),
    name: `${chain.name} (copy)`,
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
  };
  const all = loadAll();
  all.push(copy);
  saveAll(all);
  return copy;
}

export function exportChainsJson(): string {
  return JSON.stringify(loadAll(), null, 2);
}

/**
 * Import chains from JSON. Merges with existing chains:
 * - Dedupes by id
 * - Newer updatedAt wins on conflict
 */
export function importChainsJson(json: string): { added: number; updated: number; errors: string[] } {
  const errors: string[] = [];
  let imported: unknown;
  try {
    imported = JSON.parse(json);
  } catch {
    return { added: 0, updated: 0, errors: ['Invalid JSON.'] };
  }

  if (!Array.isArray(imported)) {
    return { added: 0, updated: 0, errors: ['Expected a JSON array of chains.'] };
  }

  const all = loadAll();
  let added = 0;
  let updated = 0;

  for (const item of imported as unknown[]) {
    if (typeof item !== 'object' || item === null) {
      errors.push('Skipped invalid entry (not an object).');
      continue;
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string' || !Array.isArray(entry.steps)) {
      errors.push(`Skipped entry missing required fields (id, name, steps).`);
      continue;
    }

    const chain: ToolbeltChain = {
      id: entry.id,
      name: entry.name,
      steps: entry.steps as ToolbeltChainStep[],
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    };

    // Spoof gate: reject any imported chain that references tool IDs
    // not in the built-in registry. The Wyreup registry cannot be
    // extended at runtime, so an "unknown tool" in an imported chain
    // is either stale (old version of Wyreup) or a spoofing attempt.
    // Either way: refuse it at import, never on first run.
    const validation = validateToolbeltChain(chain);
    if (!validation.ok) {
      errors.push(
        `Skipped "${chain.name}" — references unknown tool(s): ${validation.unknownTools.join(', ')}.`,
      );
      continue;
    }

    const existingIdx = all.findIndex((c) => c.id === chain.id);
    if (existingIdx >= 0) {
      const existing = all[existingIdx];
      const existingTime = new Date(existing.updatedAt).getTime();
      const incomingTime = new Date(chain.updatedAt).getTime();
      if (incomingTime > existingTime) {
        all[existingIdx] = chain;
        updated++;
      }
    } else {
      all.push(chain);
      added++;
    }
  }

  saveAll(all);
  return { added, updated, errors };
}
