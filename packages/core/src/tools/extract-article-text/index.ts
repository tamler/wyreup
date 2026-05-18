import type { ToolModule, ToolRunContext } from '../../types.js';

export interface ExtractArticleTextParams {
  /** Output format: plain text (default) or simplified HTML preserving paragraphs/headings. */
  format?: 'text' | 'html';
  /** Prepend the detected article title to the output. */
  includeTitle?: boolean;
}

export const defaultExtractArticleTextParams: ExtractArticleTextParams = {
  format: 'text',
  includeTitle: true,
};

export const extractArticleText: ToolModule<ExtractArticleTextParams> = {
  id: 'extract-article-text',
  slug: 'extract-article-text',
  name: 'Extract Article Text',
  description:
    'Strip ads, sidebars, and navigation from a web page and keep only the article body. Paste the page\'s HTML (View Source → Copy → paste here). Powered by Mozilla\'s Reader View algorithm. Runs entirely in your browser.',
  category: 'text',
  keywords: ['readability', 'reader', 'article', 'extract', 'clean', 'declutter', 'web'],

  input: {
    // We accept HTML pastes (most useful) and raw HTML files. Direct URL
    // fetching needs CORS and isn't reliable from the browser, so it's
    // intentionally out of scope here. The CLI variant can ship later
    // using a proper fetcher.
    accept: ['text/html'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',
  outputDisplay: 'prose',

  chainSuggestions: [
    'text-summarize',
    'text-translate',
    'text-sentences',
    'text-keywords',
    'text-readability',
  ],

  defaults: defaultExtractArticleTextParams,
  paramSchema: {
    format: {
      type: 'enum',
      label: 'output format',
      help: 'Plain text is best for chaining; HTML preserves headings and paragraph structure.',
      options: [
        { value: 'text', label: 'plain text' },
        { value: 'html', label: 'simplified HTML' },
      ],
    },
    includeTitle: {
      type: 'boolean',
      label: 'include title',
      help: 'Prepend the detected article title to the output.',
    },
  },

  async run(
    inputs: File[],
    params: ExtractArticleTextParams,
    ctx: ToolRunContext,
  ): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('extract-article-text accepts exactly one input.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Parsing HTML' });

    const html = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    // Readability needs a Document. Use DOMParser to build one in-process.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) throw new Error('Could not parse HTML');

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Extracting article' });

    const { Readability } = await import('@mozilla/readability');
    // Readability mutates the document; clone first so we don't trash the
    // parsed tree if any later code wants to inspect it.
    const reader = new Readability(doc.cloneNode(true) as Document);
    const article = reader.parse();

    if (!article) {
      throw new Error("Couldn't find an article body in the provided HTML.");
    }

    const format = params.format === 'html' ? 'html' : 'text';
    const includeTitle = params.includeTitle !== false;
    const title = (article.title ?? '').trim();

    let body: string;
    let mime: string;
    if (format === 'html') {
      body = article.content ?? '';
      if (includeTitle && title) body = `<h1>${escapeHtml(title)}</h1>\n${body}`;
      mime = 'text/html';
    } else {
      body = (article.textContent ?? '').trim();
      if (includeTitle && title) body = `${title}\n\n${body}`;
      mime = 'text/plain';
    }

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([body], { type: mime });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain', 'text/html'],
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
