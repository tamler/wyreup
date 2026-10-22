import type { ToolModule, ToolRunContext } from '../../types.js';
import type { WordCounterParams, WordCounterResult } from './types.js';
import { defaultWordCounterParams } from './types.js';
import { UtilityInputError, validateUtilityParams } from '../../utilities/common.js';
import { assertUnicode } from '../../utilities/text-developer.js';

export type { WordCounterParams, WordCounterResult } from './types.js';
export { defaultWordCounterParams } from './types.js';

function stripHtmlTags(text: string): string {
  return text.replace(/<[^<>]+>/g, ' ');
}

function checkCounting(signal?: AbortSignal): void {
  if (signal?.aborted) throw new UtilityInputError('$run', 'abort', 'Counting cancelled.');
}

function hasSegmenter(): boolean {
  return typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
}

function countWords(text: string, signal?: AbortSignal): number {
  checkCounting(signal);
  if (
    typeof Intl !== 'undefined' &&
    typeof (Intl as { Segmenter?: unknown }).Segmenter === 'function'
  ) {
    const segmenter = new (
      Intl as {
        Segmenter: new (
          locale: string,
          opts: { granularity: string },
        ) => { segment(text: string): Iterable<{ isWordLike: boolean }> };
      }
    ).Segmenter('en', { granularity: 'word' });
    let count = 0;
    let visits = 0;
    for (const segment of segmenter.segment(text)) {
      if ((++visits & 1023) === 0) checkCounting(signal);
      if (segment.isWordLike) count++;
    }
    checkCounting(signal);
    return count;
  }
  let count = 0;
  for (const _match of text.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu)) {
    if ((++count & 1023) === 0) checkCounting(signal);
  }
  checkCounting(signal);
  return count;
}

const schema = {
  speakingWPM: { type: 'number' as const, label: 'Speaking words per minute', min: 1, max: 1000 },
  postLimit: {
    type: 'number' as const,
    label: 'UTF-16 character limit',
    min: 0,
    max: 1000000,
    step: 1,
    help: 'Your chosen limit, measured in UTF-16 characters; no platform limit is assumed.',
  },
};

export function countWordText(
  original: string,
  params: WordCounterParams = {},
  type = 'text/plain',
  signal?: AbortSignal,
): WordCounterResult {
  if (signal?.aborted) throw new UtilityInputError('$run', 'abort', 'Counting cancelled.');
  assertUnicode(original);
  if (new TextEncoder().encode(original).length > 50 * 1024 * 1024)
    throw new UtilityInputError('$input', 'budget', 'Text exceeds 50 MiB.');
  const checked = validateUtilityParams(
    { ...defaultWordCounterParams },
    schema,
    params as Record<string, unknown>,
  );
  const text =
    type === 'text/html' || original.trimStart().startsWith('<')
      ? stripHtmlTags(original)
      : original;
  const words = countWords(text, signal);
  const characters = text.length;
  let codePoints = 0;
  for (const _character of text) {
    codePoints++;
    if ((codePoints & 1023) === 0 && signal?.aborted)
      throw new UtilityInputError('$run', 'abort', 'Counting cancelled.');
  }
  let graphemes: number | null = null;
  if (hasSegmenter()) {
    graphemes = 0;
    for (const _segment of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)) {
      if ((++graphemes & 1023) === 0) checkCounting(signal);
    }
  }
  let sentences = 0;
  let inSentenceEnding = false;
  let charactersNoSpaces = 0;
  let lines = text.length === 0 ? 0 : 1;
  let paragraphs = 0;
  let paragraphContent = false;
  let whitespaceNewlines = 0;
  for (let index = 0; index < text.length; index++) {
    if ((index & 1023) === 0) checkCounting(signal);
    const character = text[index]!;
    const ending = character === '.' || character === '!' || character === '?';
    if (ending && !inSentenceEnding) sentences++;
    inSentenceEnding = ending;
    if (character === '\n') lines++;
    if (/\s/.test(character)) {
      if (character === '\n') whitespaceNewlines++;
    } else {
      charactersNoSpaces++;
      if (paragraphContent && whitespaceNewlines >= 2) paragraphs++;
      paragraphContent = true;
      whitespaceNewlines = 0;
    }
  }
  if (paragraphContent) paragraphs++;
  const postLimit = checked.postLimit as number;
  if (signal?.aborted) throw new UtilityInputError('$run', 'abort', 'Counting cancelled.');
  return {
    words,
    characters,
    charactersNoSpaces,
    lines,
    sentences,
    paragraphs,
    readingTimeMinutes: Math.round((words / 200) * 10) / 10,
    utf8Bytes: new TextEncoder().encode(text).length,
    codePoints,
    graphemes,
    graphemeCounting: graphemes === null ? 'unavailable' : 'available',
    wordCounting: hasSegmenter() ? 'intl-segmenter' : 'unicode-token-fallback',
    speakingSeconds: (words * 60) / (checked.speakingWPM as number),
    postLimit,
    remaining: Math.max(0, postLimit - characters),
    over: Math.max(0, characters - postLimit),
  };
}

export const wordCounter: ToolModule<WordCounterParams> = {
  id: 'word-counter',
  slug: 'word-counter',
  name: 'Word Counter',
  description:
    'Count words, UTF-16 characters, Unicode code points, graphemes and UTF-8 bytes. Estimate reading and speaking time with a chosen character limit. HTML tags are stripped first; Markdown syntax is counted as written. Without Intl.Segmenter, word counts use approximate Unicode letter/number tokens; punctuation and underscores can differ from locale segmentation.',
  category: 'inspect',
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

  chainSuggestions: ['json-formatter', 'json-yaml', 'json-flatten'],
  defaults: defaultWordCounterParams,
  paramSchema: schema,

  async run(inputs: File[], params: WordCounterParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Counting cancelled.');
    if (
      inputs.length !== 1 ||
      !inputs[0] ||
      !Number.isFinite(inputs[0].size) ||
      inputs[0].size < 0 ||
      typeof inputs[0].slice !== 'function'
    )
      throw new UtilityInputError('$input', 'type', 'Select exactly one text file.');
    const file = inputs[0];
    const limit = 50 * 1024 * 1024;
    if (file.size > limit)
      throw new UtilityInputError('$input', 'budget', 'Text input exceeds 50 MiB.');
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Counting words' });
    const bytes = await file.slice(0, limit + 1).arrayBuffer();
    checkCounting(ctx.signal);
    if (bytes.byteLength > limit)
      throw new UtilityInputError('$input', 'budget', 'Text input exceeds 50 MiB.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const result = countWordText(text, params, file.type, ctx.signal);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
