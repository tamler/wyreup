import type { ToolModule, ToolRunContext } from '../../types.js';

export interface XmlFormatterParams {
  mode?: 'beautify' | 'minify';
  indent?: number;
}

export const defaultXmlFormatterParams: XmlFormatterParams = {
  mode: 'beautify',
  indent: 2,
};

// Linear one-pass comment strip: indexOf instead of a lazy regex, which
// backtracks quadratically on inputs with many unclosed openers.
function stripXmlComments(xml: string): string {
  let out = '';
  let i = 0;
  while (i < xml.length) {
    const start = xml.indexOf('<!--', i);
    if (start === -1) {
      out += xml.slice(i);
      break;
    }
    out += xml.slice(i, start);
    const end = xml.indexOf('-->', start + 4);
    if (end === -1) {
      // Unclosed comment: keep the tail, matching the old regex behavior.
      out += xml.slice(start);
      break;
    }
    i = end + 3;
  }
  return out;
}

function minifyXml(xml: string): string {
  let withoutComments = xml;
  // Bound repeated stripping so adversarial nesting cannot monopolize the event loop.
  for (let pass = 0; pass < 25; pass += 1) {
    const stripped = stripXmlComments(withoutComments);
    if (stripped === withoutComments) break;
    withoutComments = stripped;
  }

  return (
    withoutComments
      // Collapse whitespace between tags. A bare `\s+` run is linear; the
      // neighbor check replaces the backtracking-prone `/>\s+</` form.
      .replace(/\s+/g, (ws, off: number, str: string) =>
        str.charAt(off - 1) === '>' && str.charAt(off + ws.length) === '<' ? '' : ws,
      )
      .trim()
  );
}

export const xmlFormatter: ToolModule<XmlFormatterParams> = {
  id: 'xml-formatter',
  slug: 'xml-formatter',
  name: 'XML Formatter',
  description: 'Beautify or minify XML documents. Uses Prettier for beautification.',
  category: 'dev',
  keywords: ['xml', 'format', 'beautify', 'minify', 'pretty', 'indent'],

  input: {
    accept: ['text/xml', 'application/xml', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: {
    mime: 'text/xml',
    multiple: false,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultXmlFormatterParams,

  async run(inputs: File[], params: XmlFormatterParams, ctx: ToolRunContext): Promise<Blob[]> {
    const mode = params.mode ?? 'beautify';

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading formatter' });

    if (ctx.signal.aborted) throw new Error('Aborted');

    const text = await inputs[0]!.text();

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Formatting XML' });

    let result: string;
    if (mode === 'minify') {
      result = minifyXml(text);
    } else {
      const prettier = await import('prettier');
      const xmlPlugin = await import('@prettier/plugin-xml');
      const plugin = (xmlPlugin as { default?: unknown }).default ?? xmlPlugin;
      try {
        result = await prettier.format(text, {
          parser: 'xml',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          plugins: [plugin as any],
          tabWidth: params.indent ?? 2,

          xmlWhitespaceSensitivity: 'ignore',
        });
      } catch (e) {
        throw new Error(`XML formatting failed: ${(e as Error).message}`);
      }
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([result], { type: 'text/xml' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/xml'],
  },
};
