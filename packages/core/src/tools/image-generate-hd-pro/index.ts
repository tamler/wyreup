import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export type ImageGenerateHdAspect = 'square' | 'landscape' | 'portrait' | 'wide';

export interface ImageGenerateHdProParams {
  /** Output shape. Every option stays at or under one megapixel. */
  aspect?: ImageGenerateHdAspect;
}

export const defaultImageGenerateHdProParams: ImageGenerateHdProParams = { aspect: 'square' };

/** Server prompt cap, mirrored here so the client fails before spending credits. */
const MAX_PROMPT_CHARS = 2000;

interface ImageGenHdResult {
  contentType: string;
  base64: string;
}

export const imageGenerateHdPro: ToolModule<ImageGenerateHdProParams> = {
  id: 'image-generate-hd-pro',
  slug: 'image-generate-hd-pro',
  name: 'Generate Image HD',
  description:
    'Hosted FLUX.2 [klein] 9B, a newer and larger model than the Flux Schnell one behind Generate Image, for sharper, more detailed pictures. Pick a shape: 992×992 square, 1152×864 landscape, 864×1152 portrait, or 1328×752 wide, each about one megapixel. Text prompt only, up to 2,000 characters; no reference images. Uses 2 credits per run.',
  category: 'create',
  keywords: ['image', 'generate', 'flux', 'flux 2', 'klein', 'hd', 'text-to-image', 'pro'],

  input: {
    accept: ['text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 8 * 1024,
  },
  output: { mime: 'image/*' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 2,
  memoryEstimate: 'low',

  chainSuggestions: ['compress', 'convert', 'image-watermark', 'bg-remove-pro'],

  defaults: defaultImageGenerateHdProParams,
  paramSchema: {
    aspect: {
      type: 'enum',
      label: 'shape',
      options: [
        { value: 'square', label: 'Square (992×992)' },
        { value: 'landscape', label: 'Landscape 4:3 (1152×864)' },
        { value: 'portrait', label: 'Portrait 3:4 (864×1152)' },
        { value: 'wide', label: 'Wide 16:9 (1328×752)' },
      ],
    },
  },

  async run(inputs: File[], params: ImageGenerateHdProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('image-generate-hd-pro accepts exactly one prompt.');
    const prompt = (await inputs[0]!.text()).trim();
    if (!prompt) throw new Error('Prompt is empty.');
    if (prompt.length > MAX_PROMPT_CHARS)
      throw new Error(`Prompt is too long. Keep it under ${MAX_PROMPT_CHARS} characters.`);

    const result = await runPro<ImageGenHdResult>(
      'image-generate-hd-pro',
      { prompt, aspect: params.aspect ?? 'square', fileName: inputs[0]!.name },
      ctx,
    );

    const bytes = base64ToBytes(result.base64);
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([bytes.buffer as ArrayBuffer], { type: result.contentType });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['image/jpeg', 'image/png', 'image/webp'],
  },
};

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
