import type { ToolModule, ToolRunContext } from '../../types.js';

export interface HtmlCleanParams {
  /** Collapse all whitespace runs (including newlines) into single spaces. */
  collapseWhitespace?: boolean;
  /** Preserve paragraph breaks (block-level tags map to double newlines). */
  preserveParagraphs?: boolean;
  /** Decode HTML entities (&amp; → &). On by default. */
  decodeEntities?: boolean;
}

export const defaultHtmlCleanParams: HtmlCleanParams = {
  collapseWhitespace: false,
  preserveParagraphs: true,
  decodeEntities: true,
};

const HtmlCleanComponentStub = (): unknown => null;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match: string, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'div', 'dl', 'dt', 'dd',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
  'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tr', 'ul',
]);

export function cleanHtml(html: string, params: HtmlCleanParams): string {
  let text = html;

  // Strip script + style blocks entirely (including their content).
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  // Strip HTML comments.
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  if (params.preserveParagraphs ?? true) {
    // Replace block-level opening/closing tags with newlines so the
    // textual result keeps paragraph structure. <br> emits a single
    // newline, block boundaries emit two.
    text = text.replace(/<br\s*\/?\s*>/gi, '\n');
    text = text.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tag: string) => {
      return BLOCK_TAGS.has(tag.toLowerCase()) ? '\n\n' : '';
    });
  } else {
    // Drop every tag without preserving structure.
    text = text.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  }

  if (params.decodeEntities ?? true) {
    text = decodeEntities(text);
  }

  if (params.collapseWhitespace ?? false) {
    text = text.replace(/\s+/g, ' ').trim();
  } else {
    // Tighten only the runs we created with block boundaries.
    text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  return text;
}

export const htmlClean: ToolModule<HtmlCleanParams> = {
  id: 'html-clean',
  slug: 'html-clean',
  name: 'HTML Clean',
  description:
    'Strip HTML tags and decode entities to produce readable plain text. Drops <script>, <style>, and comments entirely. Different from html-to-markdown — this returns prose, not formatted markdown.',
  category: 'text',
  presence: 'both',
  keywords: ['html', 'clean', 'strip', 'plain', 'text', 'sanitize', 'extract', 'tags'],

  input: {
    accept: ['text/html', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultHtmlCleanParams,

  paramSchema: {
    preserveParagraphs: {
      type: 'boolean',
      label: 'preserve paragraphs',
      help: 'Map block-level tags (p, div, h1–h6, li, etc.) to double newlines so structure survives.',
    },
    collapseWhitespace: {
      type: 'boolean',
      label: 'collapse whitespace',
      help: 'Squash every whitespace run (including newlines) to a single space. Overrides paragraph preservation.',
    },
    decodeEntities: {
      type: 'boolean',
      label: 'decode entities',
      help: 'Turn &amp; into &, &mdash; into —, etc.',
    },
  },

  Component: HtmlCleanComponentStub,

  async run(inputs: File[], params: HtmlCleanParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('html-clean accepts exactly one HTML file.');
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Reading HTML' });
    const html = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Stripping tags' });
    const cleaned = cleanHtml(html, params);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([cleaned], { type: 'text/plain' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};
