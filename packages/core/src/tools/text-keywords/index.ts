import type { ToolModule, ToolRunContext } from '../../types.js';
import nlp from 'compromise';

export interface TextKeywordsParams {
  /** How many top entries to return per category. */
  topN?: number;
  /** Include multi-word noun phrases ("machine learning"), not just single nouns. */
  includePhrases?: boolean;
  /** Drop the most common English words from the noun pool before ranking. */
  filterStopwords?: boolean;
}

export const defaultTextKeywordsParams: TextKeywordsParams = {
  topN: 15,
  includePhrases: true,
  filterStopwords: true,
};

// Conservative stop list — words that are technically nouns but never useful
// as a topic. Keeps "compromise"'s default tagging without us shipping a
// language model.
const STOPWORDS = new Set<string>([
  'thing', 'things', 'way', 'ways', 'time', 'times', 'day', 'days', 'year', 'years',
  'people', 'person', 'man', 'woman', 'guy', 'girl',
  'kind', 'sort', 'type', 'lot', 'bit', 'fact',
  'one', 'two', 'three', 'four', 'five',
  'something', 'anything', 'everything', 'nothing',
  'someone', 'anyone', 'everyone', 'no one',
  'today', 'tomorrow', 'yesterday',
]);

interface KeywordEntry {
  term: string;
  count: number;
  kind: 'noun' | 'phrase';
}

export interface TextKeywordsResult {
  nouns: KeywordEntry[];
  phrases: KeywordEntry[];
  totalWords: number;
}

export const textKeywords: ToolModule<TextKeywordsParams> = {
  id: 'text-keywords',
  slug: 'text-keywords',
  name: 'Topic Keywords',
  description:
    'Pull the topic-bearing nouns and noun phrases out of any text. Answers "what is this about" — not "what words appear most" (try Text Frequency for that). Runs entirely in your browser.',
  category: 'text',
  keywords: ['keywords', 'topics', 'nouns', 'tags', 'summary', 'extract', 'tagging', 'nlp'],

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

  chainSuggestions: ['text-summarize', 'text-ner', 'text-frequency'],

  defaults: defaultTextKeywordsParams,
  paramSchema: {
    topN: {
      type: 'range',
      label: 'top N',
      help: 'Return up to this many entries per list.',
      min: 5,
      max: 50,
      step: 1,
    },
    includePhrases: {
      type: 'boolean',
      label: 'include phrases',
      help: 'Add multi-word noun phrases like "machine learning" alongside single nouns.',
    },
    filterStopwords: {
      type: 'boolean',
      label: 'filter stopwords',
      help: 'Drop generic nouns like "thing", "way", "people" before ranking.',
    },
  },

  async run(
    inputs: File[],
    params: TextKeywordsParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-keywords accepts exactly one input.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    const topN = Math.max(1, Math.min(100, params.topN ?? 15));
    const includePhrases = params.includePhrases !== false;
    const filterStopwords = params.filterStopwords !== false;

    const doc = nlp(text);

    // Singular nouns, lowercased — collapses "Cats" / "cats" / "cat".
    const nounRaw = doc.nouns().toSingular().out('array') as string[];
    const nouns = rank(nounRaw, filterStopwords).slice(0, topN).map(
      ([term, count]): KeywordEntry => ({ term, count, kind: 'noun' }),
    );

    let phrases: KeywordEntry[] = [];
    if (includePhrases) {
      // Multi-word noun groups only; single tokens already covered by `nouns`.
      const phraseRaw = (doc.match('#Noun+ #Noun+').out('array') as string[])
        .filter((p) => p.split(/\s+/).length >= 2);
      phrases = rank(phraseRaw, filterStopwords).slice(0, topN).map(
        ([term, count]): KeywordEntry => ({ term, count, kind: 'phrase' }),
      );
    }

    const out: TextKeywordsResult = {
      nouns,
      phrases,
      totalWords: (doc.terms().out('array') as string[]).length,
    };

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};

function rank(items: string[], filterStopwords: boolean): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const raw of items) {
    const t = raw.toLowerCase().trim();
    if (!t) continue;
    if (t.length < 2) continue;
    if (filterStopwords && STOPWORDS.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}
