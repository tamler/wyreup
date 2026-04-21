import type { ToolModule, ToolRunContext } from '../../types.js';
import type { LoremIpsumParams } from './types.js';

export type { LoremIpsumParams } from './types.js';
export { defaultLoremIpsumParams } from './types.js';

const LoremIpsumComponentStub = (): unknown => null;

const LOREM_OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';

const WORD_POOL = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
  'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
  'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
  'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate', 'velit',
  'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint', 'occaecat',
  'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia', 'deserunt',
  'mollit', 'anim', 'id', 'est',
];

function randomInt(min: number, max: number): number {
  // max inclusive
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0]! % (max - min + 1)) + min;
}

function randomWord(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return WORD_POOL[buf[0]! % WORD_POOL.length]!;
}

function generateSentence(wordCount: number): string {
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(randomWord());
  }
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
}

function generateParagraph(
  sentenceCount: number,
  wordsPerSentence: [number, number],
  firstSentence?: string,
): string {
  const sentences: string[] = [];
  if (firstSentence) {
    sentences.push(firstSentence);
    for (let i = 1; i < sentenceCount; i++) {
      sentences.push(generateSentence(randomInt(wordsPerSentence[0], wordsPerSentence[1])));
    }
  } else {
    for (let i = 0; i < sentenceCount; i++) {
      sentences.push(generateSentence(randomInt(wordsPerSentence[0], wordsPerSentence[1])));
    }
  }
  return sentences.join(' ');
}

export const loremIpsum: ToolModule<LoremIpsumParams> = {
  id: 'lorem-ipsum',
  slug: 'lorem-ipsum',
  name: 'Lorem Ipsum',
  description: 'Generate placeholder Latin text (lorem ipsum) with configurable paragraphs and sentence length.',
  category: 'create',
  presence: 'both',
  keywords: ['lorem', 'ipsum', 'placeholder', 'text', 'dummy', 'generate', 'latin'],

  input: {
    accept: [],
    min: 0,
    max: 0,
  },
  output: {
    mime: 'text/plain',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: {
    paragraphs: 3,
    sentencesPerParagraph: 5,
    wordsPerSentence: [8, 15],
    startWithLorem: true,
  },

  Component: LoremIpsumComponentStub,

  // Tool contract requires Promise return; no internal await needed.
  // eslint-disable-next-line @typescript-eslint/require-await
  async run(
    _inputs: File[],
    params: LoremIpsumParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Generating text' });

    const paragraphCount = params.paragraphs ?? 3;
    if (paragraphCount < 1 || paragraphCount > 1000) throw new Error('paragraphs must be between 1 and 1000');
    const sentenceCount = params.sentencesPerParagraph ?? 5;
    if (sentenceCount < 1 || sentenceCount > 100) throw new Error('sentencesPerParagraph must be between 1 and 100');
    const wordsPerSentence: [number, number] = params.wordsPerSentence ?? [8, 15];
    if (wordsPerSentence[1] > 100) throw new Error('wordsPerSentence max must be <= 100');
    const startWithLorem = params.startWithLorem ?? true;

    const paragraphs: string[] = [];

    for (let i = 0; i < paragraphCount; i++) {
      const firstSentence = (i === 0 && startWithLorem) ? LOREM_OPENING : undefined;
      paragraphs.push(generateParagraph(sentenceCount, wordsPerSentence, firstSentence));
    }

    const output = paragraphs.join('\n\n');

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([output], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
