/**
 * My Kit — localStorage-backed saved chains.
 * Schema version 1.
 */

const KIT_KEY = 'wyreup:my-kit:chains';
const SCHEMA_VERSION = 1;

export interface KitChainStep {
  toolId: string;
  params: Record<string, unknown>;
}

export interface KitChain {
  id: string;
  name: string;
  steps: KitChainStep[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
  schemaVersion: number;
}

function loadAll(): KitChain[] {
  try {
    const raw = localStorage.getItem(KIT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as KitChain[];
  } catch {
    return [];
  }
}

function saveAll(chains: KitChain[]): void {
  try {
    localStorage.setItem(KIT_KEY, JSON.stringify(chains));
  } catch {
    // localStorage full or unavailable
  }
}

export function getAllChains(): KitChain[] {
  return loadAll();
}

export function getChain(id: string): KitChain | undefined {
  return loadAll().find((c) => c.id === id);
}

export function saveChain(chain: Omit<KitChain, 'schemaVersion'>): void {
  const all = loadAll();
  const existing = all.findIndex((c) => c.id === chain.id);
  const withVersion: KitChain = { ...chain, schemaVersion: SCHEMA_VERSION };
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

export function duplicateChain(id: string): KitChain | null {
  const chain = getChain(id);
  if (!chain) return null;
  const now = new Date().toISOString();
  const copy: KitChain = {
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

    const chain: KitChain = {
      id: entry.id,
      name: entry.name,
      steps: entry.steps as KitChainStep[],
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    };

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
