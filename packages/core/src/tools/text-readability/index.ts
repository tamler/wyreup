import type { ToolModule, ToolRunContext } from '../../types.js';
import rs from 'text-readability';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TextReadabilityParams {}

export const defaultTextReadabilityParams: TextReadabilityParams = {};

export interface TextReadabilityResult {
  flesch: number;
  fleschKincaid: number;
  colemanLiau: number;
  smog: number;
  automatedReadability: number;
  daleChall: number;
  gunningFog: number;
  gradeLevel: string;
}

const TextReadabilityComponentStub = (): unknown => null;

export const textReadability: ToolModule<TextReadabilityParams> = {
  id: 'text-readability',
  slug: 'text-readability',
  name: 'Readability Scores',
  description: 'Compute Flesch, Gunning Fog, Coleman-Liau, and other readability scores for any text.',
  category: 'text',
  presence: 'both',
  keywords: ['readability', 'flesch', 'fog', 'grade', 'level', 'score', 'writing', 'complexity'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 5 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',
  // No installSize — pure JS, no model download

  defaults: defaultTextReadabilityParams,
  Component: TextReadabilityComponentStub,

  async run(inputs: File[], _params: TextReadabilityParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) {
      throw new Error('text-readability accepts exactly one text file.');
    }
    const input = inputs[0]!;

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Analyzing text' });

    const text = await input.text();
    if (!text.trim()) {
      throw new Error('Input text is empty.');
    }

    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Computing scores' });

    const result: TextReadabilityResult = {
      flesch: Math.round(rs.fleschReadingEase(text) * 10) / 10,
      fleschKincaid: Math.round(rs.fleschKincaidGrade(text) * 10) / 10,
      colemanLiau: Math.round(rs.colemanLiauIndex(text) * 10) / 10,
      smog: Math.round(rs.smogIndex(text) * 10) / 10,
      automatedReadability: Math.round(rs.automatedReadabilityIndex(text) * 10) / 10,
      daleChall: Math.round(rs.daleChallReadabilityScore(text) * 10) / 10,
      gunningFog: Math.round(rs.gunningFog(text) * 10) / 10,
      gradeLevel: rs.textStandard(text),
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: ['sample.txt'],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
