import type { ToolbeltChainStep } from './toolbeltStorage';

const STORAGE_KEY = 'wyreup:hop-trail';
const MAX_TRAIL_STEPS = 20;
let continuityFailed = false;

export interface TrailHandover {
  steps: ToolbeltChainStep[];
  token: string;
  targetToolId: string;
}

function isStep(value: unknown): value is ToolbeltChainStep {
  if (typeof value !== 'object' || value === null) return false;
  const step = value as Record<string, unknown>;
  return (
    typeof step.toolId === 'string' &&
    typeof step.params === 'object' &&
    step.params !== null &&
    !Array.isArray(step.params)
  );
}

function readTrail(): Record<string, unknown> | null {
  if (continuityFailed) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    continuityFailed = true;
    return null;
  }
}

export function getTrail(): ToolbeltChainStep[] {
  const steps = readTrail()?.steps;
  return Array.isArray(steps) && steps.every(isStep) ? steps.slice(0, MAX_TRAIL_STEPS) : [];
}

function validBinding(token: unknown, targetToolId: unknown): boolean {
  return (
    typeof token === 'string' &&
    token.length > 0 &&
    token.length <= 128 &&
    !Array.from(token).some(
      (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    ) &&
    typeof targetToolId === 'string' &&
    targetToolId.length <= 128 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(targetToolId)
  );
}

/** Old unbound trail data never acquires a fabricated token or destination. */
export function getTrailHandover(): TrailHandover | null {
  const record = readTrail();
  if (
    !record ||
    !validBinding(record.token, record.targetToolId) ||
    !Array.isArray(record.steps) ||
    record.steps.length > MAX_TRAIL_STEPS ||
    !record.steps.every(isStep)
  )
    return null;
  if (typeof record.token !== 'string' || typeof record.targetToolId !== 'string') return null;
  return { steps: record.steps, token: record.token, targetToolId: record.targetToolId };
}

/** Caller supplies only its OWN committed stash token and canonical destination. */
export function setTrailHandover(
  steps: ToolbeltChainStep[],
  token: string,
  targetToolId: string,
): boolean {
  if (
    !validBinding(token, targetToolId) ||
    !Array.isArray(steps) ||
    steps.length > MAX_TRAIL_STEPS ||
    !steps.every(isStep)
  ) {
    clearTrail();
    return false;
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ steps, token, targetToolId }));
    continuityFailed = false;
    return true;
  } catch {
    clearTrail();
    continuityFailed = true;
    return false;
  }
}

export function appendHop(step: ToolbeltChainStep): void {
  const steps = getTrail();
  if (steps.length >= MAX_TRAIL_STEPS) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ steps: [...steps, step] }));
    continuityFailed = false;
  } catch {
    clearTrail();
    continuityFailed = true;
  }
}

export function clearTrail(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    continuityFailed = false;
  } catch {
    continuityFailed = true;
  }
}
