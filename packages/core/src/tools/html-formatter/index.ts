import type { ToolModule, ToolRunContext } from '../../types.js';

export interface HtmlFormatterParams {
  mode?: 'beautify' | 'minify';
  printWidth?: number;
  tabWidth?: number;
}

export const defaultHtmlFormatterParams: HtmlFormatterParams = {
  mode: 'beautify',
  printWidth: 80,
  tabWidth: 2,
};

function minifyHtml(html: string): string {
  return html
    // Remove HTML comments (not conditional comments)
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    // Collapse whitespace between tags
    .replace(/>\s+</g, '> <')
    // Trim leading/trailing whitespace from lines
    .replace(/^\s+|\s+$/gm, '')
    // Collapse multiple spaces (not inside pre/code)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export const htmlFormatter: ToolModule<HtmlFormatterParams> = {
  id: 'html-formatter',
  slug: 'html-formatter',
  name: 'HTML Formatter',
  description: 'Beautify or minify HTML with Prettier. Produces clean, consistently indented markup.',
  category: 'dev',
  keywords: ['html', 'format', 'beautify', 'minify', 'pretty', 'indent', 'markup'],

  input: {
    accept: ['text/html', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: {
    mime: 'text/html',
    multiple: false,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultHtmlFormatterParams,

  async run(
    inputs: File[],
    params: HtmlFormatterParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    const mode = params.mode ?? 'beautify';

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading formatter' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Formatting HTML' });

    let result: string;
    if (mode === 'minify') {
      result = minifyHtml(text);
    } else {
      const prettier = await import('prettier');
      try {
        result = await prettier.format(text, {
          parser: 'html',
          printWidth: params.printWidth ?? 80,
          tabWidth: params.tabWidth ?? 2,
        });
      } catch (e) {
        throw new Error(`HTML formatting failed: ${(e as Error).message}`);
      }
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([result], { type: 'text/html' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/html'],
  },
};
