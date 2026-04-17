import type { ToolModule, ToolRunContext } from '../../types.js';
import type { MarkdownToHtmlParams } from './types.js';

export type { MarkdownToHtmlParams } from './types.js';
export { defaultMarkdownToHtmlParams } from './types.js';

const MarkdownToHtmlComponentStub = (): unknown => null;

export const markdownToHtml: ToolModule<MarkdownToHtmlParams> = {
  id: 'markdown-to-html',
  slug: 'markdown-to-html',
  name: 'Markdown to HTML',
  description: 'Convert Markdown to HTML with optional GitHub Flavored Markdown support.',
  category: 'convert',
  presence: 'both',
  keywords: ['markdown', 'html', 'convert', 'gfm', 'github', 'markup'],

  input: {
    accept: ['text/plain', 'text/markdown'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: {
    mime: 'text/html',
    multiple: false,
  },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { gfm: true },

  Component: MarkdownToHtmlComponentStub,

  async run(
    inputs: File[],
    params: MarkdownToHtmlParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading markdown parser' });

    const { marked } = await import('marked');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Converting markdown' });

    const text = await inputs[0]!.text();
    const html = await marked.parse(text, { gfm: params.gfm ?? true });

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([html], { type: 'text/html' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/html'],
  },
};
