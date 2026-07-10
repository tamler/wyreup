import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro, fileToBase64 } from '../../lib/pro-runner.js';

interface DetectedObject {
  label: string;
  score: number;
  box: { xmin: number; ymin: number; xmax: number; ymax: number };
}

export const detectObjects: ToolModule<Record<string, never>> = {
  id: 'detect-objects',
  slug: 'detect-objects',
  name: 'Detect Objects',
  description:
    'Detects and locates objects in an image, returning labels, confidence scores, and bounding boxes as JSON. Uses 1 credit per run.',
  category: 'export',
  keywords: ['detect', 'objects', 'bounding box', 'count', 'pro', 'vision'],

  input: {
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',
  outputDisplay: 'mono',

  chainSuggestions: ['json-path', 'json-to-xml'],

  defaults: {},
  paramSchema: {},

  async run(inputs: File[], _params: Record<string, never>, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('detect-objects accepts exactly one image.');
    const imageBase64 = await fileToBase64(inputs[0]!);
    const result = await runPro<{ objects: DetectedObject[]; count: number }>(
      'detect-objects',
      { imageBase64, fileName: inputs[0]!.name },
      ctx,
    );
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
