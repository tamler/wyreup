import type { ToolModule, ToolRunContext } from '../../types.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TextStatsParams {}

export const defaultTextStatsParams: TextStatsParams = {};

export interface TextStatsResult {
  chars: number;
  charsNoSpaces: number;
  words: number;
  sentences: number;
  paragraphs: number;
  avgWordLength: number;
  avgSentenceLength: number;
  syllables: number;
  readingTimeMinutes: number;
  speakingTimeMinutes: number;
}

// Heuristic syllable counter: counts vowel groups per word.
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  // Count vowel groups
  const vowelGroups = w.match(/[aeiou]+/g);
  let count = vowelGroups ? vowelGroups.length : 1;
  // Silent e at end
  if (w.endsWith('e') && count > 1) count--;
  return Math.max(1, count);
}

export function computeTextStats(text: string): TextStatsResult {
  const chars = text.length;
  const charsNoSpaces = text.replace(/\s/g, '').length;

  // Words: split on whitespace, filter empty
  const wordList = text.trim().split(/\s+/).filter((w) => w.length > 0);
  const words = wordList.length;

  // Sentences: split on . ! ? followed by space or end
  const sentenceList = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentences = Math.max(sentenceList.length, words > 0 ? 1 : 0);

  // Paragraphs: split on blank lines
  const paragraphList = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const paragraphs = Math.max(paragraphList.length, words > 0 ? 1 : 0);

  const avgWordLength =
    words > 0
      ? Math.round((wordList.reduce((sum, w) => sum + w.replace(/[^a-zA-Z]/g, '').length, 0) / words) * 10) / 10
      : 0;

  const avgSentenceLength =
    sentences > 0 ? Math.round((words / sentences) * 10) / 10 : 0;

  const syllables = wordList.reduce((sum, w) => sum + countSyllables(w), 0);

  // Reading/speaking time
  const readingTimeMinutes = Math.round((words / 238) * 100) / 100;
  const speakingTimeMinutes = Math.round((words / 150) * 100) / 100;

  return {
    chars,
    charsNoSpaces,
    words,
    sentences,
    paragraphs,
    avgWordLength,
    avgSentenceLength,
    syllables,
    readingTimeMinutes,
    speakingTimeMinutes,
  };
}

const TextStatsComponentStub = (): unknown => null;

export const textStats: ToolModule<TextStatsParams> = {
  id: 'text-stats',
  slug: 'text-stats',
  name: 'Text Statistics',
  description: 'Count words, sentences, paragraphs, syllables, and estimate reading time.',
  category: 'text',
  presence: 'both',
  keywords: ['stats', 'word count', 'sentences', 'paragraphs', 'syllables', 'reading time', 'character count'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultTextStatsParams,
  Component: TextStatsComponentStub,

  async run(inputs: File[], _params: TextStatsParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('text-stats accepts exactly one text file.');
    }
    const input = inputs[0]!;

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Reading text' });

    const text = await input.text();

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Computing statistics' });

    const result = computeTextStats(text);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: ['sample.txt'],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
