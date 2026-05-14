import type { ToolModule, ToolRunContext } from '../../types.js';

export interface MarkdownTocParams {
  /** Minimum heading level to include (default 1). */
  minLevel?: number;
  /** Maximum heading level to include (default 6). */
  maxLevel?: number;
  /** Indent character per level. */
  indent?: '  ' | '    ' | '\t';
  /** Skip the document's first H1 (often a duplicate of the title). */
  skipFirstH1?: boolean;
}

export const defaultMarkdownTocParams: MarkdownTocParams = {
  minLevel: 1,
  maxLevel: 6,
  indent: '  ',
  skipFirstH1: false,
};

const MarkdownTocComponentStub = (): unknown => null;

// GitHub-style slug: lowercase, strip punctuation, spaces → hyphens.
// Not byte-identical to GitHub's algorithm but matches in the cases
// that matter for TOC linking.
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

interface Heading {
  level: number;
  text: string;
}

function extractHeadings(tokens: ReadonlyArray<unknown>): Heading[] {
  const headings: Heading[] = [];
  for (const tok of tokens) {
    const t = tok as { type?: string; depth?: number; text?: string };
    if (t.type === 'heading' && typeof t.depth === 'number' && typeof t.text === 'string') {
      headings.push({ level: t.depth, text: t.text });
    }
  }
  return headings;
}

export function buildToc(markdown: string, params: MarkdownTocParams, tokens: ReadonlyArray<unknown>): string {
  const minLevel = Math.max(1, Math.min(6, params.minLevel ?? 1));
  const maxLevel = Math.max(minLevel, Math.min(6, params.maxLevel ?? 6));
  const indent = params.indent ?? '  ';
  const skipFirstH1 = params.skipFirstH1 ?? false;

  const headings = extractHeadings(tokens).filter((h) => h.level >= minLevel && h.level <= maxLevel);
  if (skipFirstH1) {
    const idx = headings.findIndex((h) => h.level === 1);
    if (idx >= 0) headings.splice(idx, 1);
  }
  if (headings.length === 0) return '';

  const baseLevel = headings.reduce((min, h) => Math.min(min, h.level), 6);

  // Disambiguate duplicate slugs the way GitHub does — append -1, -2, ...
  const seen = new Map<string, number>();
  const lines: string[] = [];
  for (const h of headings) {
    const base = slugify(h.text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const slug = count === 0 ? base : `${base}-${count}`;
    const depth = h.level - baseLevel;
    lines.push(`${indent.repeat(depth)}- [${h.text}](#${slug})`);
  }

  return lines.join('\n') + '\n';
}

export const markdownToc: ToolModule<MarkdownTocParams> = {
  id: 'markdown-toc',
  slug: 'markdown-toc',
  name: 'Markdown TOC',
  description:
    'Generate a table of contents from markdown headings. Indented list with GitHub-style anchor links — drop it at the top of the document.',
  category: 'text',
  presence: 'both',
  keywords: ['markdown', 'toc', 'table of contents', 'headings', 'outline', 'anchors'],

  input: {
    accept: ['text/plain', 'text/markdown'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'text/markdown' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultMarkdownTocParams,

  paramSchema: {
    minLevel: {
      type: 'number',
      label: 'min level',
      help: 'Smallest heading depth to include (1 = H1).',
      min: 1,
      max: 6,
      step: 1,
    },
    maxLevel: {
      type: 'number',
      label: 'max level',
      help: 'Largest heading depth to include (6 = H6).',
      min: 1,
      max: 6,
      step: 1,
    },
    indent: {
      type: 'enum',
      label: 'indent',
      options: [
        { value: '  ', label: 'two spaces' },
        { value: '    ', label: 'four spaces' },
        { value: '\t', label: 'tab' },
      ],
    },
    skipFirstH1: {
      type: 'boolean',
      label: 'skip first H1',
      help: 'Useful when the first H1 is the title and you don\'t want it in the TOC.',
    },
  },

  Component: MarkdownTocComponentStub,

  async run(inputs: File[], params: MarkdownTocParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('markdown-toc accepts exactly one markdown file.');
    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading markdown parser' });
    const { marked } = await import('marked');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Reading markdown' });
    const text = await inputs[0]!.text();

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Building table of contents' });
    const tokens = marked.lexer(text);
    const toc = buildToc(text, params, tokens);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([toc], { type: 'text/markdown' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/markdown'],
  },
};
