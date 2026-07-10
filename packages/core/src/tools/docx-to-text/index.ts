import type { ToolModule, ToolRunContext } from '../../types.js';

export interface DocxToTextParams {
  /** Preserve paragraph breaks as blank lines (true) or join into a single paragraph (false). */
  preserveParagraphs?: boolean;
  /** Include heading numbering / hierarchy markers (e.g. "## " prefix). */
  includeHeadingMarkers?: boolean;
}

export const defaultDocxToTextParams: DocxToTextParams = {
  preserveParagraphs: true,
  includeHeadingMarkers: false,
};

export const docxToText: ToolModule<DocxToTextParams> = {
  id: 'docx-to-text',
  slug: 'docx-to-text',
  name: 'DOCX to Text',
  description:
    'Extract plain text from a Word document (.docx). Runs entirely in your browser — file never uploads. Great as a chain source: feed the output into translate, summarize, or any text tool.',
  category: 'convert',
  keywords: ['docx', 'word', 'extract', 'text', 'office', 'mammoth'],

  input: {
    accept: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
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
    'text-ner',
    'text-readability',
  ],

  defaults: defaultDocxToTextParams,
  paramSchema: {
    preserveParagraphs: {
      type: 'boolean',
      label: 'preserve paragraph breaks',
      help: 'Keep blank lines between paragraphs. Off = collapses into one paragraph.',
    },
    includeHeadingMarkers: {
      type: 'boolean',
      label: 'mark headings',
      help: 'Prefix Word headings with "# " (H1) through "###### " (H6).',
    },
  },

  async run(inputs: File[], params: DocxToTextParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('docx-to-text accepts exactly one file.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Parsing DOCX' });

    // mammoth ships an isomorphic build; the bundler picks the browser
    // version automatically via the package's `browser` field. We dynamic-
    // import so the ~120 KB gz isn't paid by users of other tools.
    const mammoth = await import('mammoth');
    if (ctx.signal.aborted) throw new Error('Aborted');

    const arrayBuffer = await inputs[0]!.arrayBuffer();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Extracting text' });

    const includeHeadingMarkers = params.includeHeadingMarkers === true;
    const preserveParagraphs = params.preserveParagraphs !== false;

    // If the user wants heading markers, use mammoth's HTML output and
    // post-process (cheapest way to keep h1-h6 distinct). Otherwise the
    // raw-text endpoint is simpler and faster.
    let text: string;
    if (includeHeadingMarkers) {
      const result = await mammoth.convertToHtml({ arrayBuffer });
      text = htmlToTextWithHeadings(result.value, preserveParagraphs);
    } else {
      const result = await mammoth.extractRawText({ arrayBuffer });
      text = preserveParagraphs
        ? result.value
        : result.value.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([text], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};

// Convert mammoth's HTML (which uses <h1>…<h6>, <p>, <ul>, <ol>) to plain
// text with Markdown-style heading prefixes. We use the browser's
// DOMParser since mammoth itself depends on it in this build anyway.
function htmlToTextWithHeadings(html: string, preserveParagraphs: boolean): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const parts: string[] = [];
  for (const el of Array.from(doc.body.children)) {
    const tag = el.tagName.toLowerCase();
    const text = (el.textContent ?? '').trim();
    if (!text) continue;
    const headingMatch = tag.match(/^h([1-6])$/);
    if (headingMatch) {
      const depth = Number(headingMatch[1]);
      parts.push(`${'#'.repeat(depth)} ${text}`);
    } else {
      parts.push(text);
    }
  }
  return preserveParagraphs ? parts.join('\n\n') : parts.join(' ').replace(/\s+/g, ' ').trim();
}
