// Shared input and output shaping for the similarity Pro tools
// (text-find-similar-pro, rank-results-pro, text-cluster-pro).
//
// The caps mirror functions/_lib/providers/similarity-models.ts, which is
// authoritative. Checking here first refuses an oversized list before any
// network call.

export interface CandidateLimits {
  minItems: number;
  maxItems: number;
  maxItemChars: number;
  maxQueryChars: number;
  maxTotalChars: number;
}

export const FIND_SIMILAR_LIMITS: CandidateLimits = {
  minItems: 1,
  maxItems: 100,
  maxItemChars: 4_000,
  maxQueryChars: 4_000,
  maxTotalChars: 50_000,
};

export const RANK_LIMITS: CandidateLimits = {
  minItems: 1,
  maxItems: 100,
  maxItemChars: 2_000,
  maxQueryChars: 500,
  maxTotalChars: 50_000,
};

export const CLUSTER_LIMITS: CandidateLimits = {
  minItems: 3,
  maxItems: 100,
  maxItemChars: 4_000,
  maxQueryChars: 0,
  maxTotalChars: 50_000,
};

/**
 * Read a candidate list: a JSON array of strings, or one item per line.
 * Blank lines are skipped and each line is trimmed.
 */
export function parseCandidates(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = undefined;
    }
    if (Array.isArray(parsed)) {
      if (!parsed.every((x) => typeof x === 'string'))
        throw new Error('A JSON list must contain only strings.');
      return parsed.map((s) => s.trim()).filter((s) => s.length > 0);
    }
  }
  return trimmed
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function checkCandidates(
  items: string[],
  limits: CandidateLimits,
  query = '',
  queryLabel = 'Query',
): void {
  if (limits.maxQueryChars > 0) {
    if (!query.trim()) throw new Error(`${queryLabel} is required.`);
    if (query.length > limits.maxQueryChars)
      throw new Error(
        `${queryLabel} is longer than ${limits.maxQueryChars.toLocaleString('en-US')} characters.`,
      );
  }
  if (items.length < limits.minItems)
    throw new Error(
      `Add at least ${limits.minItems} item${limits.minItems === 1 ? '' : 's'}, one per line.`,
    );
  if (items.length > limits.maxItems)
    throw new Error(`Up to ${limits.maxItems} items per run; this list has ${items.length}.`);
  const long = items.findIndex((s) => s.length > limits.maxItemChars);
  if (long >= 0)
    throw new Error(
      `Item ${long + 1} is longer than ${limits.maxItemChars.toLocaleString('en-US')} characters.`,
    );
  const total = items.reduce((n, s) => n + s.length, query.length);
  if (total > limits.maxTotalChars)
    throw new Error(
      `Up to ${limits.maxTotalChars.toLocaleString('en-US')} characters per run in total; this run has ${total.toLocaleString('en-US')}.`,
    );
}

/** CSV cell with RFC 4180 quoting and spreadsheet formula defusing. */
export function csvCell(v: string | number): string {
  if (typeof v === 'number') return String(v);
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: Array<Array<string | number>>): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export interface RankedRow {
  rank: number;
  index: number;
  score: number;
  text: string;
}

/** CSV for a ranked list; `item` is the 1-based position in the parsed list (blank lines skipped). */
export function rankedCsv(results: RankedRow[]): string {
  return toCsv(
    ['rank', 'score', 'item', 'text'],
    results.map((r) => [r.rank, r.score, r.index + 1, r.text]),
  );
}
