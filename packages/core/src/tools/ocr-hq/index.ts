// packages/core/src/tools/ocr-hq/index.ts
import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro, fileToBase64 } from '../../lib/pro-runner.js';

export const ocrHq: ToolModule<Record<string, never>> = {
  id: 'ocr-hq',
  slug: 'ocr-hq',
  name: 'OCR (PRO)',
  description:
    'High-quality text extraction from images and scans, powered by a hosted vision model. Output is plain text — chains into translate, summarize, and other text tools. Uses 1 credit per run.',
  category: 'export',
  keywords: ['ocr', 'text', 'extract', 'scan', 'pro', 'vision', 'hosted'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',
  surfaces: ['web'],
  outputDisplay: 'prose',

  chainSuggestions: ['text-translate-pro', 'text-summarize-pro', 'text-sentences'],

  defaults: {},
  paramSchema: {},

  async run(
    inputs: File[],
    _params: Record<string, never>,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('ocr-hq accepts exactly one image.');
    const imageBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ text: string }>(
      'ocr-hq',
      { imageBase64, fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([result.text], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
