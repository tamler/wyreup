import type { ToolModule, ToolRunContext } from '../../types.js';

export interface MarkdownFrontmatterParams {
  /** Try to detect the format (YAML / TOML / JSON) automatically. */
  format?: 'auto' | 'yaml' | 'toml' | 'json';
}

export const defaultMarkdownFrontmatterParams: MarkdownFrontmatterParams = {
  format: 'auto',
};

export interface MarkdownFrontmatterResult {
  format: 'yaml' | 'toml' | 'json' | 'none';
  frontmatter: Record<string, unknown> | null;
  /** Body markdown — frontmatter block removed, leading whitespace trimmed. */
  body: string;
  /** Range of lines (1-indexed, inclusive) the frontmatter occupied in the source. Empty when no frontmatter. */
  range: { startLine: number; endLine: number } | null;
}

const MarkdownFrontmatterComponentStub = (): unknown => null;

// Match the very common forms only:
// - YAML between '---' fences
// - TOML between '+++' fences
// - JSON between '{' / '}' as the first non-blank line, or '---{' / '}---'
//
// More exotic packagings (e.g. coffeescript) are out of scope; the
// 80/20 here is YAML.
const YAML_FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const TOML_FENCE = /^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?/;
const JSON_FENCE = /^(?:---\r?\n)?(\{[\s\S]*?\n\})(?:\r?\n---)?\r?\n?/;

function lineRangeFor(source: string, matchedLength: number): { startLine: number; endLine: number } {
  const consumed = source.slice(0, matchedLength);
  const newlineCount = (consumed.match(/\r?\n/g) ?? []).length;
  // matched block ends with a newline; lines 1..newlineCount cover the block.
  return { startLine: 1, endLine: Math.max(1, newlineCount) };
}

// Very small TOML reader — supports flat `key = value` only. Anything
// nested triggers an error so we don't silently lose data. Real TOML
// would need a dep; flat KV is enough for the typical static-site
// frontmatter case.
function parseFlatToml(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('[')) {
      throw new Error('TOML frontmatter with tables/sections isn\'t supported by this tool — use YAML or JSON for nested data.');
    }
    const eq = line.indexOf('=');
    if (eq < 0) throw new Error(`Invalid TOML line ${i + 1}: ${raw}`);
    const key = line.slice(0, eq).trim();
    const rest = line.slice(eq + 1).trim();
    let value: unknown;
    if ((rest.startsWith('"') && rest.endsWith('"')) || (rest.startsWith("'") && rest.endsWith("'"))) {
      value = rest.slice(1, -1);
    } else if (rest === 'true') value = true;
    else if (rest === 'false') value = false;
    else if (!Number.isNaN(Number(rest))) value = Number(rest);
    else value = rest;
    out[key] = value;
  }
  return out;
}

export async function extractFrontmatter(
  source: string,
  format: MarkdownFrontmatterParams['format'],
): Promise<MarkdownFrontmatterResult> {
  const resolved = format && format !== 'auto' ? format : null;

  if (resolved === 'yaml' || (!resolved && YAML_FENCE.test(source))) {
    const m = YAML_FENCE.exec(source);
    if (!m) {
      if (resolved === 'yaml') throw new Error('Expected YAML frontmatter delimited by --- fences.');
      return { format: 'none', frontmatter: null, body: source, range: null };
    }
    const { load } = await import('js-yaml');
    const data = load(m[1]!) as Record<string, unknown> | null;
    return {
      format: 'yaml',
      frontmatter: data && typeof data === 'object' ? data : null,
      body: source.slice(m[0].length).replace(/^\s+/, ''),
      range: lineRangeFor(source, m[0].length),
    };
  }

  if (resolved === 'toml' || (!resolved && TOML_FENCE.test(source))) {
    const m = TOML_FENCE.exec(source);
    if (!m) {
      if (resolved === 'toml') throw new Error('Expected TOML frontmatter delimited by +++ fences.');
      return { format: 'none', frontmatter: null, body: source, range: null };
    }
    const data = parseFlatToml(m[1]!);
    return {
      format: 'toml',
      frontmatter: data,
      body: source.slice(m[0].length).replace(/^\s+/, ''),
      range: lineRangeFor(source, m[0].length),
    };
  }

  if (resolved === 'json' || (!resolved && /^\s*\{/.test(source))) {
    const m = JSON_FENCE.exec(source);
    if (!m) {
      if (resolved === 'json') throw new Error('Expected JSON frontmatter (object literal at top of document).');
      return { format: 'none', frontmatter: null, body: source, range: null };
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(m[1]!) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Frontmatter looked like JSON but couldn't be parsed: ${msg}`);
    }
    return {
      format: 'json',
      frontmatter: data,
      body: source.slice(m[0].length).replace(/^\s+/, ''),
      range: lineRangeFor(source, m[0].length),
    };
  }

  return { format: 'none', frontmatter: null, body: source, range: null };
}

export const markdownFrontmatter: ToolModule<MarkdownFrontmatterParams> = {
  id: 'markdown-frontmatter',
  slug: 'markdown-frontmatter',
  name: 'Markdown Frontmatter',
  description:
    'Extract YAML (---), TOML (+++), or JSON frontmatter from a markdown file, returning the metadata as JSON and the body separately. Auto-detects the fence style.',
  category: 'text',
  presence: 'both',
  keywords: ['markdown', 'frontmatter', 'yaml', 'toml', 'json', 'metadata', 'jekyll', 'hugo', 'gatsby', 'astro'],

  input: {
    accept: ['text/markdown', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: {
    mime: 'application/json',
    multiple: true,
  },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultMarkdownFrontmatterParams,

  paramSchema: {
    format: {
      type: 'enum',
      label: 'format',
      help: 'Auto picks YAML / TOML / JSON by the opening fence.',
      options: [
        { value: 'auto', label: 'auto-detect (recommended)' },
        { value: 'yaml', label: 'YAML (--- fences)' },
        { value: 'toml', label: 'TOML (+++ fences)' },
        { value: 'json', label: 'JSON (top-level object)' },
      ],
    },
  },

  Component: MarkdownFrontmatterComponentStub,

  async run(inputs: File[], params: MarkdownFrontmatterParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('markdown-frontmatter accepts exactly one file.');
    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Reading file' });
    const text = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Extracting frontmatter' });
    const result = await extractFrontmatter(text, params.format ?? 'auto');

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
      new Blob([result.body], { type: 'text/markdown' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json', 'text/markdown'],
  },
};
