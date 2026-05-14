import type { ToolModule, ToolRunContext } from '../../types.js';

export interface SvgOptimizerParams {
  removeComments?: boolean;
  removeMetadata?: boolean;
  precision?: number;
  removeEditorData?: boolean;
}

export const defaultSvgOptimizerParams: SvgOptimizerParams = {
  removeComments: true,
  removeMetadata: true,
  precision: 3,
  removeEditorData: true,
};

export const svgOptimizer: ToolModule<SvgOptimizerParams> = {
  id: 'svg-optimizer',
  slug: 'svg-optimizer',
  name: 'SVG Optimizer',
  description:
    'Optimize SVG files using SVGO. Removes comments, editor metadata, and rounds decimal precision.',
  category: 'optimize',
  keywords: ['svg', 'optimize', 'compress', 'svgo', 'vector', 'clean', 'minify'],

  input: {
    accept: ['image/svg+xml'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'image/svg+xml',
    multiple: false,
  },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultSvgOptimizerParams,

  async run(
    inputs: File[],
    params: SvgOptimizerParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading SVGO' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const { optimize } = await import('svgo');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Optimizing SVG' });

    const text = await inputs[0]!.text();

    const plugins: string[] = [
      'removeDoctype',
      'removeXMLProcInst',
      'removeXMLNS',
      'cleanupAttrs',
      'cleanupIds',
      'convertStyleToAttrs',
      'removeEmptyAttrs',
      'removeEmptyContainers',
      'removeUnusedNS',
      'convertColors',
      'convertTransform',
      'mergePaths',
      'sortAttrs',
    ];

    if (params.removeComments !== false) {
      plugins.push('removeComments');
    }
    if (params.removeMetadata !== false) {
      plugins.push('removeMetadata');
    }
    if (params.removeEditorData !== false) {
      plugins.push('removeEditorsNSData');
    }

    const precision = params.precision ?? 3;

    // svgo plugins type is a union that doesn't easily accept string plugin names + parametrized plugins together
    type SvgoConfig = Parameters<typeof optimize>[1];
    type SvgoPlugins = NonNullable<NonNullable<SvgoConfig>['plugins']>;
    const pluginList: SvgoPlugins = [
      ...plugins,
      { name: 'cleanupNumericValues', params: { floatPrecision: precision } },
      { name: 'convertPathData', params: { floatPrecision: precision } },
    ] as SvgoPlugins;

    let optimizedData: string;
    try {
      const result = optimize(text, { plugins: pluginList });
      optimizedData = result.data;
    } catch (e) {
      throw new Error(`SVG optimization failed: ${(e as Error).message}`);
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([optimizedData], { type: 'image/svg+xml' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['image/svg+xml'],
  },
};
