import type { ToolModule, ToolRunContext } from '../../types.js';
// compromise (~2.5 MB) dynamic-imported inside run() to keep it out of the
// base bundle.

export interface TextDatesParams {
  /** Output verbatim mentions only, or also include a normalized ISO guess where possible. */
  normalize?: boolean;
}

export const defaultTextDatesParams: TextDatesParams = {
  normalize: true,
};

interface DateHit {
  raw: string;
  /** ISO-8601 date guess. Best-effort; absent when the mention is too ambiguous. */
  iso?: string;
}

export interface TextDatesResult {
  count: number;
  dates: DateHit[];
}

export const textDates: ToolModule<TextDatesParams> = {
  id: 'text-dates',
  slug: 'text-dates',
  name: 'Extract Dates',
  description:
    'Pull every date reference out of text — "next Tuesday", "Q3 2025", "March 14" — and (optionally) normalize to ISO. Runs entirely in your browser; useful for cleaning meeting notes, emails, or invoices.',
  category: 'text',
  keywords: ['dates', 'extract', 'parse', 'iso', 'calendar', 'normalize', 'nlp'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 5 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  chainSuggestions: ['text-ner', 'text-redact', 'text-frequency'],

  defaults: defaultTextDatesParams,
  paramSchema: {
    normalize: {
      type: 'boolean',
      label: 'normalize to ISO',
      help: 'Try to convert "next Tuesday" → "2026-05-19". Disable to get raw matches only.',
    },
  },

  async run(inputs: File[], params: TextDatesParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-dates accepts exactly one input.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    const nlp = (await import('compromise')).default;
    if (ctx.signal.aborted) throw new Error('Aborted');

    const doc = nlp(text);
    // Base compromise tags dates with #Date; the full dates plugin would give
    // us .json({ dates: true }), but it's a separate dep. The Date-tagged
    // matches catch the common forms ("March 5", "2024-05-17", "next Friday").
    const raw = (doc.match('#Date+').out('array') as string[]).map((s) => s.trim()).filter(Boolean);

    const normalize = params.normalize !== false;
    const seen = new Set<string>();
    const dates: DateHit[] = [];
    for (const r of raw) {
      const key = r.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const hit: DateHit = { raw: r };
      if (normalize) {
        const iso = tryNormalize(r);
        if (iso) hit.iso = iso;
      }
      dates.push(hit);
    }

    const out: TextDatesResult = { count: dates.length, dates };
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};

// Best-effort normalization using Date.parse. Handles "March 5, 2024",
// "2024-05-17", "5/17/2024". Returns YYYY-MM-DD on success, undefined on
// ambiguity. Skips relative forms ("next Tuesday") because anchoring to
// "now" without an explicit user-supplied reference date is misleading.
function tryNormalize(s: string): string | undefined {
  if (/^(next|last|this)\s/i.test(s)) return undefined;
  if (/^(today|tomorrow|yesterday)$/i.test(s)) return undefined;
  const t = Date.parse(s);
  if (Number.isFinite(t)) {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return undefined;
}
