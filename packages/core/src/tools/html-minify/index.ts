import type { ToolModule, ToolRunContext } from '../../types.js';

export interface HtmlMinifyParams {
  collapseWhitespace?: boolean;
  removeComments?: boolean;
  removeRedundantAttributes?: boolean;
  minifyCss?: boolean;
  minifyJs?: boolean;
  removeEmptyAttributes?: boolean;
  useShortDoctype?: boolean;
}

export const defaultHtmlMinifyParams: HtmlMinifyParams = {
  collapseWhitespace: true,
  removeComments: true,
  removeRedundantAttributes: true,
  minifyCss: true,
  minifyJs: false,
  removeEmptyAttributes: true,
  useShortDoctype: true,
};

export interface HtmlMinifyResult {
  bytesIn: number;
  bytesOut: number;
  reductionPercent: number;
}

const HtmlMinifyComponentStub = (): unknown => null;

export const htmlMinify: ToolModule<HtmlMinifyParams> = {
  id: 'html-minify',
  slug: 'html-minify',
  name: 'HTML Minify',
  description:
    'Minify HTML with html-minifier-terser — collapse whitespace, drop comments and redundant attributes, optionally minify inline CSS / JS. Inverse direction of the existing html-formatter.',
  category: 'optimize',
  presence: 'both',
  keywords: ['html', 'minify', 'compress', 'optimize', 'whitespace'],

  input: {
    accept: ['text/html', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: {
    mime: 'text/html',
    multiple: true,
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultHtmlMinifyParams,

  paramSchema: {
    collapseWhitespace: {
      type: 'boolean',
      label: 'collapse whitespace',
    },
    removeComments: {
      type: 'boolean',
      label: 'remove comments',
    },
    removeRedundantAttributes: {
      type: 'boolean',
      label: 'remove redundant attributes',
      help: 'Drops attributes whose value matches the default (e.g. type="text" on <input>, method="get" on <form>).',
    },
    removeEmptyAttributes: {
      type: 'boolean',
      label: 'remove empty attributes',
    },
    minifyCss: {
      type: 'boolean',
      label: 'minify inline CSS',
    },
    minifyJs: {
      type: 'boolean',
      label: 'minify inline JS',
      help: 'Off by default — JS minification can break inline scripts that rely on specific identifiers.',
    },
    useShortDoctype: {
      type: 'boolean',
      label: 'use short doctype',
      help: 'Replace verbose XHTML doctype with <!DOCTYPE html>.',
    },
  },

  Component: HtmlMinifyComponentStub,

  async run(inputs: File[], params: HtmlMinifyParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('html-minify accepts exactly one file.');
    ctx.onProgress({ stage: 'loading-deps', percent: 15, message: 'Loading html-minifier-terser' });
    const { minify } = await import('html-minifier-terser');
    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();
    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Minifying' });
    const minified = await minify(text, {
      collapseWhitespace: params.collapseWhitespace ?? true,
      removeComments: params.removeComments ?? true,
      removeRedundantAttributes: params.removeRedundantAttributes ?? true,
      removeEmptyAttributes: params.removeEmptyAttributes ?? true,
      minifyCSS: params.minifyCss ?? true,
      minifyJS: params.minifyJs ?? false,
      useShortDoctype: params.useShortDoctype ?? true,
    });

    const bytesIn = text.length;
    const bytesOut = minified.length;
    const result: HtmlMinifyResult = {
      bytesIn,
      bytesOut,
      reductionPercent: bytesIn > 0 ? Math.round(((bytesIn - bytesOut) / bytesIn) * 10000) / 100 : 0,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([minified], { type: 'text/html' }),
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/html', 'application/json'],
  },
};
