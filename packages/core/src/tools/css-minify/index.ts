import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CssMinifyParams {
  /** Optimization level. 0 = none (basic compaction), 1 = safe (default), 2 = advanced. */
  level?: 0 | 1 | 2;
  /** Inline @import statements (advanced only). */
  inlineImports?: boolean;
}

export const defaultCssMinifyParams: CssMinifyParams = {
  level: 1,
  inlineImports: false,
};

export interface CssMinifyResult {
  bytesIn: number;
  bytesOut: number;
  reductionPercent: number;
  warnings: string[];
  errors: string[];
}

export const cssMinify: ToolModule<CssMinifyParams> = {
  id: 'css-minify',
  slug: 'css-minify',
  name: 'CSS Minify',
  description:
    'Minify CSS with clean-css. Level 1 is safe (whitespace, comments, basic optimizations); level 2 does cross-selector and value-level optimizations (merge rules, shorthand collapse). Inverse direction of the existing css-formatter.',
  category: 'optimize',
  keywords: ['css', 'minify', 'compress', 'optimize', 'whitespace'],

  input: {
    accept: ['text/css', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'text/css',
    multiple: true,
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultCssMinifyParams,

  paramSchema: {
    level: {
      type: 'enum',
      label: 'level',
      options: [
        { value: 0, label: '0 — basic (whitespace + comments)' },
        { value: 1, label: '1 — safe (default)' },
        { value: 2, label: '2 — advanced (cross-rule merging)' },
      ],
    },
    inlineImports: {
      type: 'boolean',
      label: 'inline @import',
      help: 'Resolve and inline @import statements. Requires advanced level.',
      showWhen: { field: 'level', equals: 2 },
    },
  },

  async run(inputs: File[], params: CssMinifyParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('css-minify accepts exactly one file.');
    ctx.onProgress({ stage: 'loading-deps', percent: 15, message: 'Loading clean-css' });
    const { default: CleanCSS } = await import('clean-css');
    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();
    const cleaner = new CleanCSS({
      level: params.level ?? 1,
      returnPromise: false,
      inline: (params.inlineImports ?? false) && (params.level ?? 1) === 2 ? ['all'] : ['none'],
    });

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Minifying' });
    const output = cleaner.minify(text);
    if (output.errors && output.errors.length > 0) {
      throw new Error(`CSS minify failed: ${output.errors.join('; ')}`);
    }

    const bytesIn = text.length;
    const bytesOut = output.styles.length;
    const result: CssMinifyResult = {
      bytesIn,
      bytesOut,
      reductionPercent: bytesIn > 0 ? Math.round(((bytesIn - bytesOut) / bytesIn) * 10000) / 100 : 0,
      warnings: output.warnings ?? [],
      errors: output.errors ?? [],
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([output.styles], { type: 'text/css' }),
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/css', 'application/json'],
  },
};
