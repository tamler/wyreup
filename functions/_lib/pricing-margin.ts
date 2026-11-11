// Cost-model floor for PRO pricing: never lose money.
//
// Worst-case revenue per credit is the $8 / 440-credit monthly plan net of
// payment fees (5% + $0.50 per transaction):
//   (8 * 0.95 - 0.50) / 440 = $0.016136 per credit.
// A tool's worst-case Cloudflare cost per run (max input, max output, every
// retry and fallback call) must stay at or under half its worst-case net
// revenue. pricing-margin.test.ts enforces this for every entry below.
//
// Add one line per tool. Derive the number from the caps the runner
// enforces (export a worst-case function next to them) rather than typing
// a constant, so tightening or loosening a cap re-checks the price.

import { scanPdfWorstCaseUsd } from './providers/scan-pdf-models';

export const NET_USD_PER_CREDIT = (8 * 0.95 - 0.5) / 440;
export const MAX_COST_SHARE = 0.5;

/** Highest worst-case cost allowed for a run priced at `credits`. */
export function costCeilingUsd(credits: number): number {
  return credits * NET_USD_PER_CREDIT * MAX_COST_SHARE;
}

/** Worst-case Cloudflare USD per run, keyed by PRO tool id. */
export const WORST_CASE_USD: Readonly<Record<string, number>> = {
  'pdf-scan-q-and-a-pro': scanPdfWorstCaseUsd(),
};
