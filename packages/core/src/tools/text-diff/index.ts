import type { ToolModule, ToolRunContext } from '../../types.js';
import type { TextDiffParams, TextDiffStats } from './types.js';

export type { TextDiffParams, TextDiffStats } from './types.js';
export { defaultTextDiffParams } from './types.js';

export const textDiff: ToolModule<TextDiffParams> = {
  id: 'text-diff',
  slug: 'text-diff',
  name: 'Text Diff',
  description: 'Compare two text files and produce a unified diff with change statistics.',
  category: 'inspect',
  keywords: ['diff', 'compare', 'text', 'patch', 'changes', 'unified'],

  input: {
    accept: ['text/plain'],
    min: 2,
    max: 2,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: {
    mime: 'text/plain',
    multiple: true,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { context: 3 },

  async run(
    inputs: File[],
    params: TextDiffParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading diff library' });

    const { createTwoFilesPatch } = await import('diff');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Computing diff' });

    const text1 = await inputs[0]!.text();
    const text2 = await inputs[1]!.text();
    const context = params.context ?? 3;

    const patch = createTwoFilesPatch(
      inputs[0]!.name || 'file1',
      inputs[1]!.name || 'file2',
      text1,
      text2,
      '',
      '',
      { context },
    );

    const lines = patch.split('\n');
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }

    const stats: TextDiffStats = {
      additions,
      deletions,
      changes: additions + deletions,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([patch], { type: 'text/plain' }),
      new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain', 'application/json'],
  },
};
