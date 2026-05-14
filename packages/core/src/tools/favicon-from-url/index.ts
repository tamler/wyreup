import type { ToolModule, ToolRunContext } from '../../types.js';

export interface FaviconFromUrlParams {
  /** Base URL to resolve relative href values against. */
  baseUrl?: string;
}

export const defaultFaviconFromUrlParams: FaviconFromUrlParams = {
  baseUrl: '',
};

export type FaviconRel =
  | 'icon'
  | 'shortcut icon'
  | 'apple-touch-icon'
  | 'apple-touch-icon-precomposed'
  | 'mask-icon'
  | 'manifest';

export interface FaviconLink {
  rel: FaviconRel;
  href: string;
  /** Absolute URL when baseUrl resolves. */
  resolved?: string;
  /** Declared image MIME, if the <link> tag included one. */
  type?: string;
  /** Declared size string (e.g. "32x32"), if present. */
  sizes?: string;
  /** Where this came from: link tag, meta tag, or the /favicon.ico convention. */
  source: 'link' | 'meta' | 'convention';
}

export interface FaviconFromUrlResult {
  /** First viable href found, resolved. The "if I had to pick one" answer. */
  best?: string;
  /** Every favicon candidate, in document order, with /favicon.ico appended last as a fallback. */
  candidates: FaviconLink[];
}

const REL_TO_KIND: Record<string, FaviconRel> = {
  icon: 'icon',
  'shortcut icon': 'shortcut icon',
  'apple-touch-icon': 'apple-touch-icon',
  'apple-touch-icon-precomposed': 'apple-touch-icon-precomposed',
  'mask-icon': 'mask-icon',
  manifest: 'manifest',
};

function getAttr(tag: string, attr: string): string | undefined {
  const re = new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(tag);
  if (!m) return undefined;
  return (m[1] ?? m[2] ?? m[3] ?? '').trim();
}

function tryResolve(href: string, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return base ? new URL(href, base).href : new URL(href).href;
  } catch {
    return undefined;
  }
}

export function extractFavicons(html: string, baseUrl: string): FaviconFromUrlResult {
  const candidates: FaviconLink[] = [];

  // <link> tags — handle multiple rel values per tag ("shortcut icon").
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const relAttr = getAttr(tag, 'rel');
    if (!relAttr) continue;
    const relTokens = relAttr.toLowerCase().split(/\s+/).filter(Boolean);
    const recognized = relTokens.length === 2 && relTokens.join(' ') === 'shortcut icon'
      ? 'shortcut icon'
      : relTokens.find((t) => t in REL_TO_KIND);
    if (!recognized) continue;
    const href = getAttr(tag, 'href');
    if (!href) continue;
    const kind = REL_TO_KIND[recognized]!;
    const link: FaviconLink = {
      rel: kind,
      href,
      resolved: tryResolve(href, baseUrl),
      source: 'link',
    };
    const type = getAttr(tag, 'type');
    if (type) link.type = type;
    const sizes = getAttr(tag, 'sizes');
    if (sizes) link.sizes = sizes;
    candidates.push(link);
  }

  // <meta name="msapplication-TileImage"> — Windows tile icon.
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = getAttr(tag, 'name')?.toLowerCase();
    if (name !== 'msapplication-tileimage') continue;
    const content = getAttr(tag, 'content');
    if (!content) continue;
    candidates.push({
      rel: 'icon',
      href: content,
      resolved: tryResolve(content, baseUrl),
      source: 'meta',
    });
  }

  // Always append the /favicon.ico convention as a final fallback.
  if (baseUrl) {
    const conv = tryResolve('/favicon.ico', baseUrl);
    if (conv) candidates.push({ rel: 'icon', href: '/favicon.ico', resolved: conv, source: 'convention' });
  }

  // Pick "best" — prefer link/meta over convention; among link/meta, prefer
  // any rel="icon" with a type, otherwise first declared candidate. This
  // mirrors what most browsers do.
  let best: string | undefined;
  const declared = candidates.filter((c) => c.source !== 'convention');
  const pick = declared.find((c) => c.type) ?? declared[0] ?? candidates[0];
  if (pick) best = pick.resolved ?? pick.href;

  return { best, candidates };
}

export const faviconFromUrl: ToolModule<FaviconFromUrlParams> = {
  id: 'favicon-from-url',
  slug: 'favicon-from-url',
  name: 'Favicon From URL',
  description:
    'Extract every declared favicon from an HTML document — <link rel="icon" / shortcut icon / apple-touch-icon / mask-icon>, <meta name="msapplication-TileImage">, and the /favicon.ico convention as a final fallback. Resolves to absolute URLs when a base URL is provided.',
  category: 'inspect',
  keywords: ['favicon', 'icon', 'apple-touch-icon', 'extract', 'html', 'metadata'],

  input: {
    accept: ['text/html', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultFaviconFromUrlParams,

  paramSchema: {
    baseUrl: {
      type: 'string',
      label: 'page URL',
      help: 'The page this HTML came from. Used to resolve relative href values and to fall back to /favicon.ico.',
      placeholder: 'https://example.com/article',
    },
  },

  async run(inputs: File[], params: FaviconFromUrlParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('favicon-from-url accepts exactly one HTML file.');
    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Reading HTML' });
    const html = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 75, message: 'Extracting favicons' });
    const result = extractFavicons(html, params.baseUrl ?? '');

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
