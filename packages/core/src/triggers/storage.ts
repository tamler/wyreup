// Trigger rules — storage & serialization layer.
// Adapter-agnostic: the kit JSON shape is the same whether persisted to
// browser localStorage, a Node ~/wyreup-kit.json file, or shared via URL.

import type { TriggerKit, TriggerRule } from './types.js';
import { TRIGGER_KIT_VERSION } from './types.js';

/**
 * Validate + normalize a parsed kit. Unknown shapes throw. Forward-compat
 * migration happens here when we bump TRIGGER_KIT_VERSION later.
 */
export function parseTriggerKit(input: unknown): TriggerKit {
  if (!input || typeof input !== 'object') {
    throw new Error('Trigger kit must be a JSON object.');
  }
  const obj = input as Record<string, unknown>;
  if (obj.version !== TRIGGER_KIT_VERSION) {
    throw new Error(
      `Unsupported trigger kit version: ${String(obj.version)}. ` +
        `This Wyreup understands version ${TRIGGER_KIT_VERSION}.`,
    );
  }
  if (!Array.isArray(obj.rules)) {
    throw new Error('Trigger kit must have a "rules" array.');
  }
  const rules = obj.rules.map((r, i) => parseTriggerRule(r, i));
  return { version: TRIGGER_KIT_VERSION, rules };
}

function parseTriggerRule(input: unknown, idx: number): TriggerRule {
  if (!input || typeof input !== 'object') {
    throw new Error(`Rule[${idx}] must be an object.`);
  }
  const r = input as Record<string, unknown>;

  // Required strings
  for (const k of ['id', 'name', 'mime', 'chainId'] as const) {
    if (typeof r[k] !== 'string' || r[k].length === 0) {
      throw new Error(`Rule[${idx}].${k} is required and must be a non-empty string.`);
    }
  }

  // Required numbers
  if (typeof r.order !== 'number') {
    throw new Error(`Rule[${idx}].order must be a number.`);
  }

  // Validate MIME shape (per G-spec: no bare '*' or '*/*')
  const mime = r.mime as string;
  if (mime === '*' || mime === '*/*' || !mime.includes('/')) {
    throw new Error(
      `Rule[${idx}].mime "${mime}" is too broad. ` +
        'Rules must commit to at least a top-level type (e.g. "image/*", "application/pdf").',
    );
  }

  // Rate-limit shape (optional)
  let rateLimit: TriggerRule['rateLimit'] | undefined;
  if (r.rateLimit !== undefined) {
    if (!r.rateLimit || typeof r.rateLimit !== 'object') {
      throw new Error(`Rule[${idx}].rateLimit must be an object when present.`);
    }
    const rl = r.rateLimit as Record<string, unknown>;
    if (typeof rl.count !== 'number' || typeof rl.windowMs !== 'number') {
      throw new Error(`Rule[${idx}].rateLimit must have numeric count and windowMs.`);
    }
    rateLimit = { count: rl.count, windowMs: rl.windowMs };
  }

  return {
    id: r.id as string,
    name: r.name as string,
    mime,
    chainId: r.chainId as string,
    order: r.order,
    confirmed: Boolean(r.confirmed),
    enabled: r.enabled === undefined ? true : Boolean(r.enabled),
    rateLimit,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
    confirmedAt: typeof r.confirmedAt === 'number' ? r.confirmedAt : undefined,
  };
}

/** Serialize for persistence. Stable key order for diffability. */
export function serializeTriggerKit(kit: TriggerKit): string {
  return JSON.stringify(kit, null, 2);
}

/**
 * Apply an edit to a rule. Per G2: any field change re-arms `confirmed`
 * to false (the user must approve the new behavior). Pass `confirmed:
 * true` explicitly with no other changes to keep the flag.
 */
export function updateTriggerRule(
  rule: TriggerRule,
  patch: Partial<Omit<TriggerRule, 'id' | 'createdAt'>>,
): TriggerRule {
  const next: TriggerRule = { ...rule, ...patch, updatedAt: Date.now() };

  // Detect "meaningful" edits — anything other than re-confirming.
  // We compare BEFORE Object.assign so we read the user's intent, not the merged state.
  const meaningfulKeys = ['name', 'mime', 'chainId', 'order', 'enabled', 'rateLimit'] as const;
  const meaningfulEdit = meaningfulKeys.some((k) => k in patch && patch[k] !== rule[k]);

  if (meaningfulEdit) {
    next.confirmed = false;
    next.confirmedAt = undefined;
  } else if ('confirmed' in patch) {
    next.confirmed = Boolean(patch.confirmed);
    next.confirmedAt = patch.confirmed ? Date.now() : undefined;
  }

  return next;
}

/**
 * Import-from-share guard (G2): rules coming from outside the user's
 * device — chain URLs, kit exports — always land as confirmed=false.
 * The receiver hasn't reviewed them.
 */
export function strippedForImport(kit: TriggerKit): TriggerKit {
  return {
    version: kit.version,
    rules: kit.rules.map((r) => ({
      ...r,
      confirmed: false,
      confirmedAt: undefined,
    })),
  };
}
