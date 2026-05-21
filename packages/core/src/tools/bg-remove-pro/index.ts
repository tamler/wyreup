import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro } from '../../lib/pro-runner.js';

export type BgRemoveProParams = Record<string, never>;

export const defaultBgRemoveProParams: BgRemoveProParams = {};

interface BgRemoveResult {
  contentType: string;
  base64: string;
}

export const bgRemovePro: ToolModule<BgRemoveProParams> = {
  id: 'bg-remove-pro',
  slug: 'bg-remove-pro',
  name: 'Background Remove',
  description:
    'Hosted large RMBG model — cleaner edges on hair, glass, and fine detail than the in-browser version. Output is a transparent PNG. Uses 3 credits per run.',
  category: 'edit',
  keywords: ['background', 'remove', 'rmbg', 'transparent', 'cutout', 'pro'],

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

  chainSuggestions: ['compress', 'image-watermark', 'convert'],

  defaults: defaultBgRemoveProParams,

  async run(
    inputs: File[],
    _params: BgRemoveProParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('bg-remove-pro accepts exactly one image.');
    const file = inputs[0]!;
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 15, message: 'Uploading image' });

    // Send as a data: URL — the server's provider wrapper accepts these
    // directly and avoids any third-party hosting roundtrip.
    const dataUrl = await fileToDataUrl(file);
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Running hosted RMBG' });

    const result = await runPro<BgRemoveResult>(
      'bg-remove-pro',
      { image: dataUrl, fileName: file.name },
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
