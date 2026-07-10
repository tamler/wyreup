import type { ToolModule, ToolRunContext } from '../../types.js';
import type { MarkdownToHtmlParams } from './types.js';

export type { MarkdownToHtmlParams } from './types.js';
export { defaultMarkdownToHtmlParams } from './types.js';

/** True for hrefs whose protocol can execute script when clicked. */
function isDangerousHref(href: string): boolean {
  // Strip whitespace/control chars (NUL, tab, newline, space) that browsers
  // ignore inside a scheme, e.g. `java\tscript:` or ` javascript:`.
  // eslint-disable-next-line no-control-regex -- intentional control-char strip
  const cleaned = href.replace(/[\x00-\x20]/g, '').toLowerCase();
  return /^(javascript|data|vbscript):/.test(cleaned);
}

/** Escape HTML-significant characters so raw markup renders as inert text. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const markdownToHtml: ToolModule<MarkdownToHtmlParams> = {
  id: 'markdown-to-html',
  slug: 'markdown-to-html',
  name: 'Markdown to HTML',
  description: 'Convert Markdown to HTML with optional GitHub Flavored Markdown support.',
  category: 'convert',
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

  async run(inputs: File[], params: MarkdownToHtmlParams, ctx: ToolRunContext): Promise<Blob[]> {
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading markdown parser' });

    const { Marked } = await import('marked');

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Converting markdown' });

    // Use a local Marked instance (not the shared `marked` singleton) so our
    // overrides can't leak into other callers. The output is a text/html blob
    // that gets chained into html-to-pdf / rendered directly, so it must be
    // safe against XSS:
    //   1. Raw HTML embedded in the markdown (<script>, <img onerror=…>) is
    //      escaped to inert text via the `html` token renderer rather than
    //      passed through as live markup.
    //   2. Dangerous link/image protocols (javascript:, data:, vbscript:) are
    //      neutralized in walkTokens — marked 15 does NOT strip these by
    //      default, so a `[x](javascript:alert(1))` would otherwise emit a
    //      live href.
    const md = new Marked({
      gfm: params.gfm ?? true,
      renderer: {
        html({ text }) {
          return escapeHtml(text);
        },
      },
      walkTokens(token) {
        if (
          (token.type === 'link' || token.type === 'image') &&
          typeof token.href === 'string' &&
          isDangerousHref(token.href)
        ) {
          token.href = '#';
        }
      },
    });

    const text = await inputs[0]!.text();
    const html = await md.parse(text);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([html], { type: 'text/html' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/html'],
  },
};
