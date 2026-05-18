import type { ToolModule, ToolRunContext } from '../../types.js';
// compromise (~2.5 MB) is dynamic-imported inside run() — see siblings
// text-keywords and text-dates for the same pattern. Keeps the base
// bundle slim for users who never invoke an NLP tool.

export interface TextSentencesParams {
  /** Emit one sentence per line (true) or wrap each in quotes joined by commas (false). */
  oneLine?: boolean;
  /** Number sentences (1. 2. 3. …) for use as a chain feed. */
  numbered?: boolean;
}

export const defaultTextSentencesParams: TextSentencesParams = {
  oneLine: true,
  numbered: false,
};

export const textSentences: ToolModule<TextSentencesParams> = {
  id: 'text-sentences',
  slug: 'text-sentences',
  name: 'Split Sentences',
  description:
    'Split prose into individual sentences using natural-language analysis. Great as a chain primitive — feed each sentence to translate, summarize, or sentiment downstream.',
  category: 'text',
  keywords: ['sentences', 'split', 'tokenize', 'segment', 'nlp', 'compromise'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 5 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',
  outputDisplay: 'prose',

  chainSuggestions: ['text-translate', 'text-summarize', 'text-sentiment', 'text-ner'],

  defaults: defaultTextSentencesParams,
  paramSchema: {
    oneLine: {
      type: 'boolean',
      label: 'one sentence per line',
      help: 'Off = comma-separated single line.',
    },
    numbered: {
      type: 'boolean',
      label: 'number sentences',
      help: 'Prefix each with "1.", "2.", etc.',
    },
  },

  async run(
    inputs: File[],
    params: TextSentencesParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('text-sentences accepts exactly one input.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    const nlp = (await import('compromise')).default;
    if (ctx.signal.aborted) throw new Error('Aborted');

    const sentences = (nlp(text).sentences().out('array') as string[])
      .map((s) => s.trim())
      .filter(Boolean);

    const numbered = params.numbered === true;
    const oneLine = params.oneLine !== false;

    let out: string;
    if (oneLine) {
      out = sentences
        .map((s, i) => (numbered ? `${i + 1}. ${s}` : s))
        .join('\n');
    } else {
      out = sentences
        .map((s, i) => (numbered ? `${i + 1}. ${s}` : s))
        .join(', ');
    }

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([out], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
