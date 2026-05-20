import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export interface UpscaleProParams {
  scale?: 2 | 4;
}

export const defaultUpscaleProParams: UpscaleProParams = {
  scale: 2,
};

interface UpscaleResult {
  contentType: string;
  base64: string;
  scale?: number;
}

export const upscale2xPro: ToolModule<UpscaleProParams> = {
  id: 'upscale-2x-pro',
  slug: 'upscale-2x-pro',
  name: 'Upscale (PRO)',
  description:
    'Hosted Real-ESRGAN upscale, 2× or 4×. Sharper edges, better fine detail than the in-browser variant — and faster on large inputs since the GPU does the heavy lifting. Uses 3 credits per run.',
  category: 'edit',
  keywords: ['upscale', 'enhance', 'real-esrgan', 'resolution', 'pro'],

  input: {
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'image/png' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 3,
  memoryEstimate: 'low',
  surfaces: ['web'],

  chainSuggestions: ['compress', 'convert', 'bg-remove-pro'],

  defaults: defaultUpscaleProParams,
  paramSchema: {
    scale: {
      type: 'enum',
      label: 'scale factor',
      help: '2× is faster and usually sufficient; 4× is best for small source images.',
      options: [
        { value: 2, label: '2×' },
        { value: 4, label: '4×' },
      ],
    },
  },

  async run(
    inputs: File[],
    params: UpscaleProParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('upscale-2x-pro accepts exactly one image.');
    const file = inputs[0]!;
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 15, message: 'Uploading image' });

    const dataUrl = await fileToDataUrl(file);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const scale = params.scale === 4 ? 4 : 2;
    ctx.onProgress({
      stage: 'processing',
      percent: 50,
      message: `Running hosted upscale (${scale}×)`,
    });

    const result = await runPro<UpscaleResult>(
      'upscale-2x-pro',
      { image: dataUrl, scale, fileName: file.name },
      ctx,
    );

    const bytes = base64ToBytes(result.base64);
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([bytes.buffer as ArrayBuffer], { type: result.contentType });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['image/png'],
  },
};

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('Read failed'));
    r.readAsDataURL(file);
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
