// Shape-level input limits beyond bytes. Used by tools whose dominant
// DoS vector is something other than file size — e.g. a small PDF
// with 50 000 pages, or a small WebM with 24 hours of audio.
//
// Each check is opt-in: a tool declares the budget it cares about
// (maxPages for PDFs, maxDuration for audio/video) and calls the
// corresponding helper from inside its run() implementation, before
// it starts the expensive parse/transform.

import type { ToolBudget } from '../types.js';

export class BudgetExceededError extends Error {
  constructor(
    public readonly kind: 'pages' | 'duration' | 'dimensions',
    public readonly observed: number | string,
    public readonly limit: number | string,
  ) {
    super(`Input ${kind} ${observed} exceeds limit ${limit}`);
    this.name = 'BudgetExceededError';
  }
}

/** Check a PDF's page count against the budget. Throws BudgetExceededError
 *  if over. The caller must pass the page count it already computed
 *  (every PDF tool calls pdf.numPages during its existing flow). */
export function assertPdfPageBudget(numPages: number, budget: ToolBudget | undefined): void {
  if (!budget?.maxPages) return;
  if (numPages > budget.maxPages) {
    throw new BudgetExceededError('pages', numPages, budget.maxPages);
  }
}

/** Same shape for the audio/video duration check.
 *  Caller passes the duration in seconds (after probing the file). */
export function assertDurationBudget(durationSeconds: number, budget: ToolBudget | undefined): void {
  if (!budget?.maxDuration) return;
  if (durationSeconds > budget.maxDuration) {
    throw new BudgetExceededError('duration', `${durationSeconds.toFixed(1)}s`, `${budget.maxDuration}s`);
  }
}

/** Image-dimension check. Pass width and height from the decoded image. */
export function assertDimensionsBudget(
  width: number,
  height: number,
  budget: ToolBudget | undefined,
): void {
  if (!budget?.maxDimensions) return;
  const { width: maxW, height: maxH } = budget.maxDimensions;
  if (width > maxW || height > maxH) {
    throw new BudgetExceededError('dimensions', `${width}x${height}`, `${maxW}x${maxH}`);
  }
}
