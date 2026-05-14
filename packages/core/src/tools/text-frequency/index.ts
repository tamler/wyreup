import type { ToolModule, ToolRunContext } from '../../types.js';

export interface TextFrequencyParams {
  /** Max entries per ranked list. */
  topN?: number;
  /** Strip ASCII case-distinctions before counting. */
  caseInsensitive?: boolean;
  /** Skip whitespace characters from the character histogram. */
  ignoreWhitespace?: boolean;
  /** Length of the n-gram histogram (1 = char, 2 = bigram, 3 = trigram). */
  ngramSize?: number;
}

export const defaultTextFrequencyParams: TextFrequencyParams = {
  topN: 20,
  caseInsensitive: true,
  ignoreWhitespace: true,
  ngramSize: 2,
};

export interface FrequencyEntry {
  key: string;
  count: number;
  percent: number;
}

export interface TextFrequencyResult {
  totals: {
    chars: number;
    words: number;
    lines: number;
    distinctChars: number;
    distinctWords: number;
  };
  charHistogram: FrequencyEntry[];
  wordHistogram: FrequencyEntry[];
  ngramHistogram: FrequencyEntry[];
  ngramSize: number;
}

const TextFrequencyComponentStub = (): unknown => null;

function buildHistogram(counts: Map<string, number>, total: number, topN: number): FrequencyEntry[] {
  const entries: FrequencyEntry[] = [];
  for (const [key, count] of counts) {
    entries.push({ key, count, percent: total > 0 ? Math.round((count / total) * 10000) / 100 : 0 });
  }
  entries.sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
  return entries.slice(0, topN);
}

export function analyzeFrequency(text: string, params: TextFrequencyParams): TextFrequencyResult {
  const topN = Math.max(1, Math.min(1000, params.topN ?? 20));
  const ngramSize = Math.max(1, Math.min(6, params.ngramSize ?? 2));
  const caseInsensitive = params.caseInsensitive ?? true;
  const ignoreWhitespace = params.ignoreWhitespace ?? true;

  const normalized = caseInsensitive ? text.toLowerCase() : text;

  const charCounts = new Map<string, number>();
  let charTotal = 0;
  for (const ch of normalized) {
    if (ignoreWhitespace && /\s/.test(ch)) continue;
    charCounts.set(ch, (charCounts.get(ch) ?? 0) + 1);
    charTotal++;
  }

  const ngramCounts = new Map<string, number>();
  let ngramTotal = 0;
  if (ngramSize > 1) {
    const stripped = ignoreWhitespace ? normalized.replace(/\s+/g, '') : normalized;
    const arr = [...stripped];
    for (let i = 0; i + ngramSize <= arr.length; i++) {
      const gram = arr.slice(i, i + ngramSize).join('');
      ngramCounts.set(gram, (ngramCounts.get(gram) ?? 0) + 1);
      ngramTotal++;
    }
  }

  const wordCounts = new Map<string, number>();
  let wordTotal = 0;
  // \p{Letter}+\p{Mark}*([-'’]\p{Letter}+)* — Unicode-aware word tokenizer
  // that keeps "don't" and "well-known" as single tokens.
  const wordRe = /[\p{Letter}\p{Mark}\p{Number}]+(?:[''’\-][\p{Letter}\p{Mark}\p{Number}]+)*/gu;
  for (const match of normalized.matchAll(wordRe)) {
    const w = match[0];
    wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
    wordTotal++;
  }

  const lines = text === '' ? 0 : text.split(/\r?\n/).length;

  return {
    totals: {
      chars: charTotal,
      words: wordTotal,
      lines,
      distinctChars: charCounts.size,
      distinctWords: wordCounts.size,
    },
    charHistogram: buildHistogram(charCounts, charTotal, topN),
    wordHistogram: buildHistogram(wordCounts, wordTotal, topN),
    ngramHistogram: ngramSize > 1 ? buildHistogram(ngramCounts, ngramTotal, topN) : [],
    ngramSize,
  };
}

export const textFrequency: ToolModule<TextFrequencyParams> = {
  id: 'text-frequency',
  slug: 'text-frequency',
  name: 'Text Frequency',
  description:
    'Top characters, words, and n-grams by frequency. Useful for data inspection, cryptanalysis warm-ups, and quick text profiling.',
  category: 'inspect',
  presence: 'both',
  keywords: ['frequency', 'histogram', 'count', 'words', 'characters', 'ngram', 'bigram', 'trigram', 'analysis', 'text'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 20 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultTextFrequencyParams,

  paramSchema: {
    topN: {
      type: 'number',
      label: 'top N',
      help: 'Maximum entries per ranked list.',
      min: 1,
      max: 1000,
      step: 1,
    },
    caseInsensitive: {
      type: 'boolean',
      label: 'case-insensitive',
      help: 'Treat A and a as the same character/word.',
    },
    ignoreWhitespace: {
      type: 'boolean',
      label: 'ignore whitespace',
      help: 'Exclude whitespace from the character and n-gram histograms.',
    },
    ngramSize: {
      type: 'enum',
      label: 'n-gram size',
      help: 'Length of contiguous-character n-grams to count. 2 = bigrams, 3 = trigrams. Set to 1 to skip.',
      options: [
        { value: 1, label: '1 — skip n-grams' },
        { value: 2, label: '2 — bigrams' },
        { value: 3, label: '3 — trigrams' },
        { value: 4, label: '4 — 4-grams' },
      ],
    },
  },

  Component: TextFrequencyComponentStub,

  async run(inputs: File[], params: TextFrequencyParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('text-frequency accepts exactly one text input.');
    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Reading text' });
    const text = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Counting' });
    const result = analyzeFrequency(text, params);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
