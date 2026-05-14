import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CssFormatterParams {
  mode?: 'beautify' | 'minify';
  printWidth?: number;
  tabWidth?: number;
}

export const defaultCssFormatterParams: CssFormatterParams = {
  mode: 'beautify',
  printWidth: 80,
  tabWidth: 2,
};

function minifyCss(css: string): string {
  return css
    // Remove CSS comments
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    // Remove spaces around structural characters
    .replace(/\s*([{}:;,>~+])\s*/g, '$1')
    // Remove trailing semicolons before closing brace
    .replace(/;}/g, '}')
    .trim();
}

export const cssFormatter: ToolModule<CssFormatterParams> = {
  id: 'css-formatter',
  slug: 'css-formatter',
  name: 'CSS Formatter',
  description: 'Beautify or minify CSS stylesheets using Prettier.',
  category: 'dev',
  keywords: ['css', 'format', 'beautify', 'minify', 'stylesheet', 'pretty', 'indent'],

  input: {
    accept: ['text/css', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: {
    mime: 'text/css',
    multiple: false,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultCssFormatterParams,

  async run(
    inputs: File[],
    params: CssFormatterParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const mode = params.mode ?? 'beautify';

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading formatter' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Formatting CSS' });

    let result: string;
    if (mode === 'minify') {
      result = minifyCss(text);
    } else {
      const prettier = await import('prettier');
      try {
        result = await prettier.format(text, {
          parser: 'css',
          printWidth: params.printWidth ?? 80,
          tabWidth: params.tabWidth ?? 2,
        });
      } catch (e) {
        throw new Error(`CSS formatting failed: ${(e as Error).message}`);
      }
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([result], { type: 'text/css' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/css'],
  },
};
