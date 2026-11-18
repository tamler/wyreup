// Worst-case Cloudflare cost per Pro run, checked against the margin floor.
//
// Rule (approved 2026-11-11): one run's worst-case provider cost must be at
// most 50% of the worst-case net revenue for the credits it charges.
// Worst-case revenue per credit is the $8 / 440-credit monthly plan after a
// 5% + $0.50 payment fee: (8 x 0.95 - 0.50) / 440 = $0.016136.
//
// "Worst case" means the largest input the server accepts, the full output
// token budget, and every call the runner can make (including a fallback
// call after a failed, possibly still billed, primary call).
//
// Same layout and names as PR #101's cost-model.ts so the two merge by
// adding rows. cost-model.test.ts asserts every entry clears the floor.

import { PRICING } from './pricing';
import { MODEL_CLEF_FLASH, checklistWorstCaseUsd } from './providers/checklist-models';

export const WORST_NET_USD_PER_CREDIT = (8 * 0.95 - 0.5) / 440;
export const MAX_COST_SHARE = 0.5;

export interface WorstCase {
  toolId: string;
  /** Human-readable description of the worst case. */
  detail: string;
  usd: number;
}

export const WORST_CASES: readonly WorstCase[] = [
  {
    toolId: 'text-checklist-pro',
    detail: `${MODEL_CLEF_FLASH}: one call, input-only billing capped at the full context window, no output charge`,
    usd: checklistWorstCaseUsd(),
  },
];

export function floorUsd(toolId: string): number {
  const credits = PRICING[toolId];
  if (credits === undefined) throw new Error(`No price for ${toolId}`);
  return credits * WORST_NET_USD_PER_CREDIT * MAX_COST_SHARE;
}
