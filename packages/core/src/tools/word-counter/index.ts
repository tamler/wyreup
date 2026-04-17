import type { ToolModule, ToolRunContext } from '../../types.js';
import type { WordCounterParams, WordCounterResult } from './types.js';

export type { WordCounterParams, WordCounterResult } from './types.js';
export { defaultWordCounterParams } from './types.js';

const WordCounterComponentStub = (): unknown => null;

function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, ' ');
}

function countWords(text: string): number {
  if (typeof Intl !== 'undefined' && typeof (Intl as { Segmenter?: unknown }).Segmenter === 'function') {
    const segmenter = new (Intl as { Segmenter: new (locale: string, opts: { granularity: string }) => { segment(text: string): Iterable<{ isWordLike: boolean }> } }).Segmenter('en', { granularity: 'word' });
    return [...segmenter.segment(text)].filter((s) => s.isWordLike).length;
  }
  // Fallback for environments without Intl.Segmenter
  const matches = text.match(/\b\S+\b/g);
  return matches ? matches.length : 0;
}

export const wordCounter: ToolModule<WordCounterParams> = {
  id: 'word-counter',
  slug: 'word-counter',
  name: 'Word Counter',
  description: 'Count words, characters, sentences, paragraphs, and estimate reading time.',
  category: 'inspect',
  presence: 'both',
  keywords: ['word', 'count', 'character', 'sentence', 'paragraph', 'reading', 'time'],

  input: {
    accept: ['text/plain', 'text/html', 'text/markdown'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {},

  Component: WordCounterComponentStub,

  async run(
    inputs: File[],
    _params: WordCounterParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Counting words' });

    const file = inputs[0]!;
    let text = await file.text();

    // Strip HTML tags for HTML input
    if (file.type === 'text/html' || text.trimStart().startsWith('<')) {
      text = stripHtmlTags(text);
    }

    const words = countWords(text);
    const characters = text.length;
    const charactersNoSpaces = text.replace(/\s/g, '').length;
    const lines = text === '' ? 0 : text.split('\n').length;

    // Sentences: split on .!? followed by whitespace or end of string
    const sentenceMatches = text.match(/[^.!?]*[.!?]+/g);
    const sentences = sentenceMatches ? sentenceMatches.filter((s) => s.trim().length > 0).length : 0;

    // Paragraphs: blocks separated by one or more blank lines
    const paragraphMatches = text.split(/\n\s*\n/);
    const paragraphs = paragraphMatches.filter((p) => p.trim().length > 0).length;

    const readingTimeMinutes = Math.round((words / 200) * 10) / 10;

    const result: WordCounterResult = {
      words,
      characters,
      charactersNoSpaces,
      sentences,
      paragraphs,
      lines,
      readingTimeMinutes,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
