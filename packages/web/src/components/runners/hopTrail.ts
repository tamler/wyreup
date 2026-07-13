import type { ToolbeltChainStep } from './toolbeltStorage';

const STORAGE_KEY = 'wyreup:hop-trail';
const MAX_TRAIL_STEPS = 20;

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

export function getTrail(): ToolbeltChainStep[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return [];
    const steps = (parsed as { steps?: unknown }).steps;
    if (!Array.isArray(steps) || !steps.every(isStep)) return [];
    return steps.slice(0, MAX_TRAIL_STEPS);
  } catch {
    return [];
  }
}

export function appendHop(step: ToolbeltChainStep): void {
  const steps = getTrail();
  if (steps.length >= MAX_TRAIL_STEPS) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ steps: [...steps, step] }));
  } catch {
    /* sessionStorage unavailable or full */
  }
}

export function clearTrail(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
}
