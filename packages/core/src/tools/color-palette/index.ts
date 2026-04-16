import type { ToolModule, ToolRunContext } from '../../types.js';
import type { ColorPaletteParams, ColorPaletteResult } from './types.js';

export type { ColorPaletteParams, ColorPaletteResult } from './types.js';
export { defaultColorPaletteParams } from './types.js';

const ColorPaletteComponentStub = (): unknown => null;

export const colorPalette: ToolModule<ColorPaletteParams> = {
  id: 'color-palette',
  slug: 'color-palette',
  name: 'Color Palette',
  description: 'Extract dominant colors from an image as hex codes.',
  category: 'inspect',
  presence: 'both',
  keywords: ['color', 'palette', 'dominant', 'extract', 'vibrant', 'inspect'],

  input: {
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { count: 5 },

  Component: ColorPaletteComponentStub,

  async run(
    inputs: File[],
    params: ColorPaletteParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (ctx.signal.aborted) throw new Error('Aborted');

    const count = params.count ?? 5;
    const input = inputs[0]!;

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Loading image' });

    const buffer = await input.arrayBuffer();
    const nodeBuffer = Buffer.from(buffer);

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Analyzing colors' });

    const { Vibrant } = await import('node-vibrant/node');
    const palette = await Vibrant.from(nodeBuffer).getPalette();

    ctx.onProgress({ stage: 'encoding', percent: 80, message: 'Building palette' });

    const swatches = Object.values(palette).filter(Boolean);
    swatches.sort((a, b) => (b!.population - a!.population));
    const topColors = swatches.slice(0, count).map((s) => s!.hex);

    const result: ColorPaletteResult = {
      vibrant: palette.Vibrant?.hex ?? null,
      muted: palette.Muted?.hex ?? null,
      darkVibrant: palette.DarkVibrant?.hex ?? null,
      darkMuted: palette.DarkMuted?.hex ?? null,
      lightVibrant: palette.LightVibrant?.hex ?? null,
      lightMuted: palette.LightMuted?.hex ?? null,
      topColors,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([JSON.stringify(result)], { type: 'application/json' });
  },

  __testFixtures: {
    valid: ['photo.jpg', 'graphic.png'],
    weird: ['corrupted.jpg'],
    expectedOutputMime: ['application/json'],
  },
};
