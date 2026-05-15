/**
 * Trigger rules — localStorage-backed persistence.
 *
 * The on-disk shape is exactly @wyreup/core's TriggerKit (v1) so the
 * matcher in core can read it without translation, and so the user can
 * export / share / sync the same JSON across devices.
 *
 * Security: every read/write here is local-only. Imports of foreign kits
 * land with `confirmed: false` on every rule (G2 import-from-share
 * invariant — enforced via strippedForImport from @wyreup/core).
 */

import {
  parseTriggerKit,
  serializeTriggerKit,
  strippedForImport,
  updateTriggerRule as coreUpdate,
  pruneFires,
  type TriggerKit,
  type TriggerRule,
  type FireRecord,
  TRIGGER_KIT_VERSION,
} from '@wyreup/core';

const RULES_KEY = 'wyreup:toolbelt:trigger-rules';
const FIRES_KEY = 'wyreup:toolbelt:trigger-fires';
const FIRES_MAX = 500;

function emptyKit(): TriggerKit {
  return { version: TRIGGER_KIT_VERSION, rules: [] };
}

function loadKit(): TriggerKit {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (!raw) return emptyKit();
    const parsed: unknown = JSON.parse(raw);
    return parseTriggerKit(parsed);
  } catch {
    return emptyKit();
  }
}

function saveKit(kit: TriggerKit): void {
  try {
    localStorage.setItem(RULES_KEY, serializeTriggerKit(kit));
  } catch {
    // Quota or unavailable — silently no-op; the UI's optimistic state
    // is the user's session memory until next reload.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('wyreup:trigger-rules-changed'));
  }
}

export function getAllRules(): TriggerRule[] {
  return loadKit().rules;
}

export function getRule(id: string): TriggerRule | undefined {
  return loadKit().rules.find((r) => r.id === id);
}

export function upsertRule(rule: TriggerRule): void {
  const kit = loadKit();
  const idx = kit.rules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) kit.rules[idx] = rule;
  else kit.rules.push(rule);
  saveKit(kit);
}

export function updateRule(
  id: string,
  patch: Partial<Omit<TriggerRule, 'id' | 'createdAt'>>,
): TriggerRule | undefined {
  const kit = loadKit();
  const rule = kit.rules.find((r) => r.id === id);
  if (!rule) return undefined;
  const next = coreUpdate(rule, patch);
  const idx = kit.rules.indexOf(rule);
  kit.rules[idx] = next;
  saveKit(kit);
  return next;
}

export function deleteRule(id: string): void {
  const kit = loadKit();
  kit.rules = kit.rules.filter((r) => r.id !== id);
  saveKit(kit);
}

/** Move a rule's `order` up (toward higher priority). */
export function reorderRule(id: string, direction: 'up' | 'down'): void {
  const kit = loadKit();
  const rules = [...kit.rules].sort((a, b) => a.order - b.order);
  const idx = rules.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= rules.length) return;
  [rules[idx].order, rules[swapWith].order] = [rules[swapWith].order, rules[idx].order];
  saveKit({ ...kit, rules });
}

export function exportRulesJson(): string {
  return serializeTriggerKit(loadKit());
}

/**
 * Import a kit from JSON. Per G2, every imported rule lands with
 * `confirmed: false` regardless of what the source set — the receiver
 * hasn't reviewed them.
 */
export function importRulesJson(json: string): {
  imported: number;
  errors: string[];
} {
  let parsed: TriggerKit;
  try {
    parsed = strippedForImport(parseTriggerKit(JSON.parse(json) as unknown));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { imported: 0, errors: [msg] };
  }
  // Replace strategy: imported kit fully overwrites current rules.
  // Use a separate merge path if/when rule sync becomes a real feature.
  saveKit(parsed);
  return { imported: parsed.rules.length, errors: [] };
}

/** Compute the next available `order` for a new rule. */
export function nextOrder(): number {
  const rules = loadKit().rules;
  if (rules.length === 0) return 0;
  return Math.max(...rules.map((r) => r.order)) + 1;
}

// ──── Fire history (G7 rate limit support) ─────────────────────────────

function loadFires(): FireRecord[] {
  try {
    const raw = localStorage.getItem(FIRES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is FireRecord =>
        !!f &&
        typeof f === 'object' &&
        typeof (f as FireRecord).ruleId === 'string' &&
        typeof (f as FireRecord).firedAt === 'number',
    );
  } catch {
    return [];
  }
}

function saveFires(fires: FireRecord[]): void {
  try {
    // Bound the list: keep the most recent FIRES_MAX entries.
    const trimmed = fires.slice(-FIRES_MAX);
    localStorage.setItem(FIRES_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore quota
  }
}

export function getFires(): FireRecord[] {
  return loadFires();
}

export function recordFire(ruleId: string): void {
  const fires = loadFires();
  fires.push({ ruleId, firedAt: Date.now() });
  // Drop entries older than the longest active rate-limit window —
  // they can no longer influence any G7 decision and just inflate
  // localStorage. The FIRES_MAX hard cap stays as belt-and-suspenders.
  const rules = loadKit().rules;
  saveFires(pruneFires(fires, rules));
}
