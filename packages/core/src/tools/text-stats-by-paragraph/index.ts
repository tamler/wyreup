import type { ToolModule, ToolRunContext } from '../../types.js';
import rs from 'text-readability';

export interface TextStatsByParagraphParams {
  /** Highlight paragraphs above this Flesch-Kincaid grade level as "dense". */
  denseGradeThreshold?: number;
  /** Minimum paragraph word count to score. Shorter paragraphs get stats but no readability scores. */
  minWordsForReadability?: number;
}

export const defaultTextStatsByParagraphParams: TextStatsByParagraphParams = {
  denseGradeThreshold: 14,
  minWordsForReadability: 30,
};

export interface ParagraphStats {
  index: number;
  /** Character offset where this paragraph starts in the source. */
  start: number;
  /** First 80 characters of the paragraph for visual identification. */
  preview: string;
  chars: number;
  words: number;
  sentences: number;
  averageWordLength: number;
  /** Only present when paragraph word count >= minWordsForReadability. */
  readability?: {
    flesch: number;
    fleschKincaid: number;
    gunningFog: number;
  };
  dense?: boolean;
}

export interface TextStatsByParagraphResult {
  paragraphCount: number;
  totalWords: number;
  totalChars: number;
  denseCount: number;
  averageWordsPerParagraph: number;
  paragraphs: ParagraphStats[];
}

const TextStatsByParagraphComponentStub = (): unknown => null;

function splitParagraphs(text: string): Array<{ body: string; start: number }> {
  const out: Array<{ body: string; start: number }> = [];
  // Paragraph boundary = one or more blank lines (allowing for \r\n).
  const re = /(?:\r?\n[ \t]*\r?\n)+/g;
  let cursor = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const body = text.slice(cursor, m.index);
    if (body.trim()) out.push({ body, start: cursor });
    cursor = re.lastIndex;
  }
  const tail = text.slice(cursor);
  if (tail.trim()) out.push({ body: tail, start: cursor });
  return out;
}

function countWords(text: string): number {
  const matches = text.match(/[\p{Letter}\p{Number}]+(?:[''’\-][\p{Letter}\p{Number}]+)*/gu);
  return matches ? matches.length : 0;
}

function countSentences(text: string): number {
  // Naive but stable: split on terminal punctuation followed by whitespace
  // (or end of string). Good enough for proportional stats; not for
  // ground-truth NLP.
  const matches = text.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  return matches && matches.length > 0 ? matches.length : 1;
}

export const textStatsByParagraph: ToolModule<TextStatsByParagraphParams> = {
  id: 'text-stats-by-paragraph',
  slug: 'text-stats-by-paragraph',
  name: 'Text Stats by Paragraph',
  description:
    'Per-paragraph length and readability stats — word/sentence/char counts plus Flesch / Flesch-Kincaid / Gunning Fog for paragraphs above a minimum size. Flags the dense paragraphs so editors know where to focus.',
  category: 'text',
  presence: 'both',
  keywords: ['readability', 'paragraph', 'editorial', 'review', 'flesch', 'stats', 'long-form'],

  input: {
    accept: ['text/plain', 'text/markdown'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultTextStatsByParagraphParams,

  paramSchema: {
    denseGradeThreshold: {
      type: 'number',
      label: 'dense grade threshold',
      help: 'Paragraphs at or above this Flesch-Kincaid grade level get flagged dense. Default 14 (sophomore year of college).',
      min: 6,
      max: 20,
      step: 1,
    },
    minWordsForReadability: {
      type: 'number',
      label: 'min words for readability',
      help: 'Short paragraphs (under this word count) skip the readability scores — they aren\'t reliable on small samples.',
      min: 5,
      max: 200,
      step: 1,
    },
  },

  Component: TextStatsByParagraphComponentStub,

  async run(inputs: File[], params: TextStatsByParagraphParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('text-stats-by-paragraph accepts exactly one text input.');
    const denseThreshold = params.denseGradeThreshold ?? 14;
    const minWordsForReadability = params.minWordsForReadability ?? 30;

    ctx.onProgress({ stage: 'processing', percent: 25, message: 'Reading text' });
    const text = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 55, message: 'Splitting paragraphs' });
    const paras = splitParagraphs(text);

    ctx.onProgress({ stage: 'processing', percent: 75, message: 'Scoring' });
    let totalWords = 0;
    let denseCount = 0;
    const paragraphs: ParagraphStats[] = paras.map(({ body, start }, idx) => {
      const trimmed = body.trim();
      const chars = trimmed.length;
      const words = countWords(trimmed);
      const sentences = countSentences(trimmed);
      const avgWordLen = words > 0
        ? Math.round((trimmed.replace(/\s+/g, '').length / words) * 100) / 100
        : 0;
      totalWords += words;
      const preview = trimmed.slice(0, 80) + (trimmed.length > 80 ? '…' : '');
      const stats: ParagraphStats = {
        index: idx,
        start,
        preview,
        chars,
        words,
        sentences,
        averageWordLength: avgWordLen,
      };
      if (words >= minWordsForReadability) {
        stats.readability = {
          flesch: Math.round(rs.fleschReadingEase(trimmed) * 100) / 100,
          fleschKincaid: Math.round(rs.fleschKincaidGrade(trimmed) * 100) / 100,
          gunningFog: Math.round(rs.gunningFog(trimmed) * 100) / 100,
        };
        if (stats.readability.fleschKincaid >= denseThreshold) {
          stats.dense = true;
          denseCount++;
        }
      }
      return stats;
    });

    const result: TextStatsByParagraphResult = {
      paragraphCount: paragraphs.length,
      totalWords,
      totalChars: text.length,
      denseCount,
      averageWordsPerParagraph: paragraphs.length > 0
        ? Math.round((totalWords / paragraphs.length) * 100) / 100
        : 0,
      paragraphs,
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
