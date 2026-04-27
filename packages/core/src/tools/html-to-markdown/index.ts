import type { ToolModule, ToolRunContext } from '../../types.js';
import type { HtmlToMarkdownParams } from './types.js';

export type { HtmlToMarkdownParams } from './types.js';
export { defaultHtmlToMarkdownParams } from './types.js';

const HtmlToMarkdownComponentStub = (): unknown => null;

export const htmlToMarkdown: ToolModule<HtmlToMarkdownParams> = {
  id: 'html-to-markdown',
  slug: 'html-to-markdown',
  name: 'HTML to Markdown',
  description: 'Convert HTML to clean Markdown text.',
  category: 'convert',
  presence: 'both',
  keywords: ['html', 'markdown', 'convert', 'turndown', 'markup'],

  input: {
    accept: ['text/html', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: {
    mime: 'text/plain',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { headingStyle: 'atx' },

  paramSchema: {
    headingStyle: {
      type: 'enum',
      label: 'heading style',
      help: 'ATX uses # ##. Setext uses === underlines for h1 and --- for h2 (h3+ fall back to ATX).',
      options: [
        { value: 'atx', label: 'ATX (# Heading)' },
        { value: 'setext', label: 'Setext (Heading\\n===)' },
      ],
    },
  },

  Component: HtmlToMarkdownComponentStub,

  async run(
    inputs: File[],
    params: HtmlToMarkdownParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading HTML converter' });

    const TurndownService = (await import('turndown')).default;

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Converting HTML' });

    const html = await inputs[0]!.text();
    const headingStyle = params.headingStyle ?? 'atx';

    const td = new TurndownService({ headingStyle });
    const markdown: string = td.turndown(html);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([markdown], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
