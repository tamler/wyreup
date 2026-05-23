import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface ImageGenerateProParams {
  /** Diffusion steps. 4 is the schnell sweet spot. */
  steps?: number;
}

export const defaultImageGenerateProParams: ImageGenerateProParams = { steps: 4 };

interface ImageGenResult {
  contentType: string;
  base64: string;
}

export const imageGeneratePro: ToolModule<ImageGenerateProParams> = {
  id: 'image-generate-pro',
  slug: 'image-generate-pro',
  name: 'Generate Image',
  description:
    'Hosted Flux Schnell — turns a text prompt into a 1024×1024 JPEG in seconds. Pair it with Background Remove or Upscale to take the result further. Uses 1 credit per run.',
  category: 'create',
  keywords: ['image', 'generate', 'flux', 'text-to-image', 'diffusion', 'pro'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 4 * 1024,
  },
  output: { mime: 'image/jpeg' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',
  surfaces: ['web'],

  chainSuggestions: ['bg-remove-pro', 'upscale-2x-pro', 'image-watermark'],

  defaults: defaultImageGenerateProParams,
  paramSchema: {
    steps: {
      type: 'range',
      label: 'steps',
      min: 1,
      max: 8,
      step: 1,
      help: 'More steps = slightly better quality, slightly higher cost. Schnell plateaus past 4.',
    },
  },

  async run(
    inputs: File[],
    params: ImageGenerateProParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('image-generate-pro accepts exactly one prompt.');
    const prompt = (await inputs[0]!.text()).trim();
    if (!prompt) throw new Error('Prompt is empty.');

    const result = await runPro<ImageGenResult>(
      'image-generate-pro',
      { prompt, steps: params.steps ?? 4, fileName: inputs[0]!.name },
      ctx,
    );

    const bytes = base64ToBytes(result.base64);
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([bytes.buffer as ArrayBuffer], { type: result.contentType });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['image/jpeg'] },
};

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
