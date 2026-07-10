import type { ToolModule, ToolRunContext } from '../../types.js';
import { ocr, defaultOcrParams } from '../ocr/index.js';
import { analyzeSuspicious, defaultTextSuspiciousParams } from '../text-suspicious/index.js';

export const ocrSuspicious: ToolModule<Record<string, never>> = {
  id: 'ocr-suspicious',
  slug: 'ocr-suspicious',
  name: 'Scan Image for Suspicious Text',
  description:
    'Reads the text in an image, then scans it for prompt-injection phrases, invisible characters, confusable glyphs, and mixed scripts. Run it before feeding a screenshot or photo to an AI.',
  category: 'inspect',
  keywords: ['ocr', 'suspicious', 'prompt injection', 'security', 'image', 'screenshot', 'scan'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 25 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: true,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: {},
  paramSchema: {},

  async run(inputs: File[], _params: Record<string, never>, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('ocr-suspicious accepts exactly one image.');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Reading text from image' });
    const ocrOut = await ocr.run([inputs[0]!], { ...defaultOcrParams }, ctx);
    const text = (await (Array.isArray(ocrOut) ? ocrOut[0]! : ocrOut).text()).trim();
    if (!text) throw new Error('No text found in the image to scan.');

    ctx.onProgress({
      stage: 'processing',
      percent: 85,
      message: 'Scanning for suspicious content',
    });
    const result = analyzeSuspicious(text, { ...defaultTextSuspiciousParams });

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
      new Blob([text], { type: 'text/plain' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json', 'text/plain'],
  },
};
