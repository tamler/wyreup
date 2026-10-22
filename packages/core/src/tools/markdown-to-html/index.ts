import type { ToolModule, ToolRunContext } from '../../types.js';
import type { Token, Tokens } from 'marked';
import type { MarkdownToHtmlParams } from './types.js';
import { UtilityInputError } from '../../utilities/common.js';

export type { MarkdownToHtmlParams } from './types.js';
export { defaultMarkdownToHtmlParams } from './types.js';

/** True for hrefs whose protocol can execute script when clicked. */
function isDangerousHref(href: string, decode: (text: string) => string): boolean {
  // Strip whitespace/control chars (NUL, tab, newline, space) that browsers
  // ignore inside a scheme, e.g. `java\tscript:` or ` javascript:`.
  const cleaned = decode(href)
    // eslint-disable-next-line no-control-regex -- intentional control-char strip
    .replace(/[\x00-\x20]/g, '')
    .toLowerCase();
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

/** Bound native rendering before any reference href is expanded into HTML. */
function prepareMarkdown(
  tokens: Token[],
  inputBytes: number,
  signal: AbortSignal,
  decode: (text: string) => string,
): number {
  const outputLimit = Math.min(50 * 1024 * 1024, Math.max(1024 * 1024, inputBytes * 64));
  let outputBytes = 0;
  let visits = 0;
  let work = 0;
  let cacheBytes = 0;
  const hrefs = new Map<string, { dangerous: boolean; bytes: number }>();
  const stack: { token: Token | Tokens.TableCell; depth: number; cell: boolean }[] = [];
  const budget = (message: string): never => {
    throw new UtilityInputError('$input', 'budget', message);
  };
  const cancelled = () => {
    if (signal.aborted) throw new UtilityInputError('$run', 'abort', 'Conversion cancelled.');
  };
  const charge = (bytes: number) => {
    if (bytes > outputLimit - outputBytes)
      budget('Conservative Markdown HTML expansion exceeds its output budget.');
    outputBytes += bytes;
  };
  const scan = (units: number) => {
    if (units > 128 * 1024 * 1024 - work)
      budget('Markdown string-scan work exceeds 128 MiB units.');
    work += units;
    cancelled();
  };
  const escapedBytes = (text: string): number => {
    scan(text.length);
    let bytes = 0;
    for (let index = 0; index < text.length; index++) {
      if ((index & 1023) === 0) cancelled();
      const code = text.charCodeAt(index);
      if (code === 38 || code === 39) bytes += 5;
      else if (code === 60 || code === 62) bytes += 4;
      else if (code === 34) bytes += 6;
      else if (code < 128) bytes++;
      else if (code < 2048) bytes += 2;
      else if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        index + 1 < text.length &&
        text.charCodeAt(index + 1) >= 0xdc00 &&
        text.charCodeAt(index + 1) <= 0xdfff
      ) {
        bytes += 4;
        index++;
      } else bytes += 3;
      if (bytes > outputLimit - outputBytes)
        budget('Conservative Markdown HTML expansion exceeds its output budget.');
    }
    return bytes;
  };
  const hrefBound = (href: string): { bytes: number; keyBytes: number } => {
    // A fixed work charge covers bounds, decoding, control stripping and scheme scans.
    scan(href.length * 6);
    let bytes = 0;
    let keyBytes = 0;
    for (let index = 0; index < href.length; index++) {
      if ((index & 1023) === 0) cancelled();
      const code = href.charCodeAt(index);
      let utf8 = code < 128 ? 1 : code < 2048 ? 2 : 3;
      if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        index + 1 < href.length &&
        href.charCodeAt(index + 1) >= 0xdc00 &&
        href.charCodeAt(index + 1) <= 0xdfff
      ) {
        utf8 = 4;
        index++;
      }
      keyBytes += utf8;
      bytes +=
        code < 128 && /[A-Za-z0-9;/?:@&=+$,#\-_.!~*'()]/.test(String.fromCharCode(code))
          ? 1
          : utf8 * 3;
      if (bytes > outputLimit - outputBytes)
        budget('Conservative Markdown HTML expansion exceeds its output budget.');
    }
    return { bytes, keyBytes };
  };
  const enqueue = (token: Token | Tokens.TableCell, depth: number, cell = false) => {
    if ((visits & 1023) === 0) cancelled();
    if (depth > 128) budget('Markdown parser nesting exceeds 128 levels.');
    if (++visits > 100000) budget('Markdown exceeds 100000 token/cell/list-item visits.');
    charge(128);
    stack.push({ token, depth, cell });
  };
  const children = (items: Token[], depth: number) => {
    for (const item of items) enqueue(item, depth);
  };
  children(tokens, 1);
  while (stack.length) {
    if ((stack.length & 1023) === 0) cancelled();
    const item = stack.pop()!;
    if (item.cell) {
      children((item.token as Tokens.TableCell).tokens, item.depth + 1);
      continue;
    }
    const token = item.token as Token;
    switch (token.type) {
      case 'space':
      case 'hr':
      case 'br':
        break;
      case 'table': {
        const table = token as Tokens.Table;
        for (const cell of table.header) enqueue(cell, item.depth + 1, true);
        for (const row of table.rows) for (const cell of row) enqueue(cell, item.depth + 1, true);
        break;
      }
      case 'list':
        children((token as Tokens.List).items, item.depth + 1);
        break;
      case 'blockquote':
      case 'list_item':
      case 'heading':
      case 'paragraph':
      case 'strong':
      case 'em':
      case 'del':
        children((token as Tokens.Paragraph).tokens, item.depth + 1);
        break;
      case 'link':
      case 'image': {
        const linked = token as Tokens.Link | Tokens.Image;
        let entry = hrefs.get(linked.href);
        if (!entry) {
          const bound = hrefBound(linked.href);
          entry = { bytes: bound.bytes, dangerous: isDangerousHref(linked.href, decode) };
          if (hrefs.size < 256 && bound.keyBytes <= 1024 * 1024 - cacheBytes) {
            hrefs.set(linked.href, entry);
            cacheBytes += bound.keyBytes;
          }
        }
        charge(entry.bytes);
        if (entry.dangerous) linked.href = '#';
        if (linked.title) charge(escapedBytes(linked.title));
        if (linked.tokens) children(linked.tokens, item.depth + 1);
        else charge(escapedBytes(linked.text));
        break;
      }
      case 'code': {
        const code = token as Tokens.Code;
        charge(escapedBytes(code.text));
        if (code.lang) charge(escapedBytes(code.lang));
        break;
      }
      case 'html':
      case 'codespan':
      case 'escape':
        charge(escapedBytes((token as Tokens.Text).text));
        break;
      case 'text': {
        const text = token as Tokens.Text;
        if (text.tokens) children(text.tokens, item.depth + 1);
        else charge(escapedBytes(text.text));
        break;
      }
      default:
        budget('Unsupported Markdown token shape.');
    }
  }
  cancelled();
  return outputLimit;
}

export const markdownToHtml: ToolModule<MarkdownToHtmlParams> = {
  id: 'markdown-to-html',
  slug: 'markdown-to-html',
  name: 'Markdown to HTML',
  description:
    'Convert Markdown to HTML with GFM and inert raw HTML. Input admission is limited to 10 MiB; conservative HTML bounds are 50 MiB and 64x input (minimum 1 MiB), with 100000 token/cell/item visits, parser depth 128 and bounded string-scan work. Any document shape, including a literal paragraph, can exceed these bounds or native parser capacity below the input limit.',
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

  chainSuggestions: ['html-to-pdf', 'html-to-markdown', 'html-formatter', 'html-clean'],
  defaults: { gfm: true },
  paramSchema: {
    gfm: { type: 'boolean', label: 'GitHub Flavored Markdown' },
  },

  async run(inputs: File[], params: MarkdownToHtmlParams, ctx: ToolRunContext): Promise<Blob[]> {
    const cancelled = () => {
      if (ctx.signal.aborted) throw new UtilityInputError('$run', 'abort', 'Conversion cancelled.');
    };
    cancelled();
    const file = inputs[0];
    if (
      inputs.length !== 1 ||
      !file ||
      !Number.isFinite(file.size) ||
      file.size < 0 ||
      typeof file.slice !== 'function'
    )
      throw new UtilityInputError('$input', 'type', 'Select exactly one Markdown file.');
    const limit = 10 * 1024 * 1024;
    if (file.size > limit)
      throw new UtilityInputError('$input', 'budget', 'Markdown input exceeds 10 MiB.');
    if (params.gfm !== undefined && typeof params.gfm !== 'boolean')
      throw new UtilityInputError('gfm', 'type', 'GFM must be a boolean.');
    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading markdown parser' });

    const [{ Marked, Renderer }, { decodeHTMLAttribute }] = await Promise.all([
      import('marked'),
      import('entities/lib/decode.js'),
    ]);
    cancelled();

    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Converting markdown' });

    // Use a local Marked instance (not the shared `marked` singleton) so our
    // overrides can't leak into other callers. The output is a text/html blob
    // that gets chained into html-to-pdf / rendered directly, so it must be
    // safe against XSS:
    //   1. Raw HTML embedded in the markdown (<script>, <img onerror=…>) is
    //      escaped to inert text via the `html` token renderer rather than
    //      passed through as live markup.
    //   2. Dangerous link/image protocols (javascript:, data:, vbscript:) are
    //      neutralized before rendering — marked 15 does NOT strip these by
    //      default, so a `[x](javascript:alert(1))` would otherwise emit a
    //      live href.
    const md = new Marked({
      gfm: params.gfm ?? true,
      renderer: {
        html({ text }) {
          return escapeHtml(text);
        },
        image(token) {
          const semanticAlt = this.parser.parseInline(token.tokens, this.parser.textRenderer);
          const quotedAlt = semanticAlt.replace(/"/g, '&quot;');
          const quotedToken: Tokens.Text = { type: 'text', raw: quotedAlt, text: quotedAlt };
          return Renderer.prototype.image.call(this, { ...token, tokens: [quotedToken] });
        },
      },
    });

    const bytes = await file.slice(0, limit + 1).arrayBuffer();
    cancelled();
    if (bytes.byteLength > limit)
      throw new UtilityInputError('$input', 'budget', 'Markdown input exceeds 10 MiB.');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new UtilityInputError('$input', 'type', 'Markdown input must be valid UTF-8.');
    }
    let tokens: ReturnType<typeof md.lexer>;
    try {
      tokens = md.lexer(text);
    } catch (cause) {
      if (cause instanceof RangeError)
        throw new UtilityInputError(
          '$input',
          'budget',
          'Markdown exceeds native parser capacity for this document. Use a smaller or simpler document.',
        );
      throw cause;
    }
    cancelled();
    const outputLimit = prepareMarkdown(tokens, bytes.byteLength, ctx.signal, decodeHTMLAttribute);
    let html: ReturnType<typeof md.parser>;
    try {
      html = md.parser(tokens);
    } catch (cause) {
      if (cause instanceof RangeError)
        throw new UtilityInputError(
          '$input',
          'budget',
          'Markdown exceeds native parser capacity for this document. Use a smaller or simpler document.',
        );
      throw cause;
    }
    cancelled();
    const output = new Blob([html], { type: 'text/html' });
    if (output.size > outputLimit)
      throw new UtilityInputError('$input', 'budget', 'Markdown HTML exceeds its output budget.');

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [output];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/html'],
  },
};
