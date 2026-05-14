import type { ToolModule, ToolRunContext } from '../../types.js';
import type { SvgToPngParams } from './types.js';
import type { ResvgRenderOptions } from '@resvg/resvg-js';

export type { SvgToPngParams } from './types.js';
export { defaultSvgToPngParams } from './types.js';

export const svgToPng: ToolModule<SvgToPngParams> = {
  id: 'svg-to-png',
  slug: 'svg-to-png',
  name: 'SVG to PNG',
  description: 'Convert SVG files to PNG images with optional scale factor and background color.',
  category: 'convert',
  keywords: ['svg', 'png', 'convert', 'vector', 'rasterize', 'image'],

  input: {
    accept: ['image/svg+xml'],
    min: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'image/png',
    multiple: true,
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: {
    scale: 1,
  },

  async run(
    inputs: File[],
    params: SvgToPngParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading SVG renderer' });

    const { Resvg } = await import('@resvg/resvg-js');

    const scale = params.scale ?? 1;
    const results: Blob[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      ctx.onProgress({
        stage: 'processing',
        percent: Math.round((i / inputs.length) * 100),
        message: `Rendering ${i + 1} of ${inputs.length}`,
      });

      const svgText = await inputs[i]!.text();
      const opts: ResvgRenderOptions = {};

      if (scale !== 1) {
        opts.fitTo = { mode: 'zoom', value: scale };
      }
      if (params.background) {
        opts.background = params.background;
      }

      const resvg = new Resvg(svgText, opts);
      const pngData = resvg.render();
      const pngBuffer = pngData.asPng();

      results.push(new Blob([new Uint8Array(pngBuffer)], { type: 'image/png' }));
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return results;
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['image/png'],
  },
};
