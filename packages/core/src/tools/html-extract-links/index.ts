import type { ToolModule, ToolRunContext } from '../../types.js';

export interface HtmlExtractLinksParams {
  /** Base URL to resolve relative links against. Empty = leave them relative. */
  baseUrl?: string;
  /** Group results by element type vs. emit a flat list. */
  group?: boolean;
  /** Drop duplicates within each group. */
  dedupe?: boolean;
}

export const defaultHtmlExtractLinksParams: HtmlExtractLinksParams = {
  baseUrl: '',
  group: true,
  dedupe: true,
};

export type LinkKind = 'a' | 'img' | 'script' | 'link' | 'iframe' | 'form' | 'video' | 'audio' | 'source';

export interface ExtractedLink {
  kind: LinkKind;
  attr: 'href' | 'src' | 'action';
  url: string;
  /** Absolute URL when baseUrl was provided and the original could be resolved. */
  resolved?: string;
  /** Hostname extracted when the URL is absolute (or after resolution). */
  hostname?: string;
}

export interface HtmlExtractLinksResult {
  total: number;
  byKind: Partial<Record<LinkKind, number>>;
  hostnames: Record<string, number>;
  links: ExtractedLink[];
}

const LINK_PATTERNS: ReadonlyArray<{ kind: LinkKind; attr: 'href' | 'src' | 'action'; re: RegExp }> = [
  { kind: 'a', attr: 'href', re: /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi },
  { kind: 'link', attr: 'href', re: /<link\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi },
  { kind: 'img', attr: 'src', re: /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi },
  { kind: 'script', attr: 'src', re: /<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi },
  { kind: 'iframe', attr: 'src', re: /<iframe\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi },
  { kind: 'video', attr: 'src', re: /<video\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi },
  { kind: 'audio', attr: 'src', re: /<audio\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi },
  { kind: 'source', attr: 'src', re: /<source\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi },
  { kind: 'form', attr: 'action', re: /<form\b[^>]*?\baction\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi },
];

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function tryResolve(url: string, base: string): { resolved?: string; hostname?: string } {
  try {
    const u = base ? new URL(url, base) : new URL(url);
    return { resolved: u.href, hostname: u.hostname };
  } catch {
    return {};
  }
}

export function extractLinks(html: string, params: HtmlExtractLinksParams): HtmlExtractLinksResult {
  const base = (params.baseUrl ?? '').trim();
  const dedupe = params.dedupe ?? true;

  const links: ExtractedLink[] = [];
  const byKind: HtmlExtractLinksResult['byKind'] = {};
  const hostnames: Record<string, number> = {};
  const seen = new Set<string>();

  for (const { kind, attr, re } of LINK_PATTERNS) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (!raw) continue;
      const url = decodeEntities(raw);
      const fingerprint = `${kind}|${attr}|${url}`;
      if (dedupe && seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      const link: ExtractedLink = { kind, attr, url };
      const { resolved, hostname } = tryResolve(url, base);
      if (resolved) link.resolved = resolved;
      if (hostname) {
        link.hostname = hostname;
        hostnames[hostname] = (hostnames[hostname] ?? 0) + 1;
      }
      links.push(link);
      byKind[kind] = (byKind[kind] ?? 0) + 1;
    }
  }

  return { total: links.length, byKind, hostnames, links };
}

export const htmlExtractLinks: ToolModule<HtmlExtractLinksParams> = {
  id: 'html-extract-links',
  slug: 'html-extract-links',
  name: 'HTML Extract Links',
  description:
    'Pull every href / src / action from HTML, classified by element (a / img / script / link / iframe / video / audio / source / form). Optional base URL to resolve relative links. Regex-based so broken HTML still parses.',
  category: 'text',
  keywords: ['html', 'links', 'extract', 'href', 'src', 'urls', 'scrape', 'crawl'],

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

  defaults: defaultHtmlExtractLinksParams,

  paramSchema: {
    baseUrl: {
      type: 'string',
      label: 'base URL',
      help: 'Used to resolve relative links to absolute URLs and to extract hostnames.',
      placeholder: 'https://example.com/article',
    },
    dedupe: {
      type: 'boolean',
      label: 'dedupe',
      help: 'Drop duplicate (element + URL) combinations.',
    },
  },

  async run(inputs: File[], params: HtmlExtractLinksParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('html-extract-links accepts exactly one HTML file.');
    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Reading HTML' });
    const html = await inputs[0]!.text();
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Extracting links' });
    const result = extractLinks(html, params);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
