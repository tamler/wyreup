import type { ToolModule, ToolRunContext } from '../../types.js';

export interface UrlParseParams {
  url?: string;
}

export const defaultUrlParseParams: UrlParseParams = {
  url: '',
};

export interface UrlParseResult {
  href: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;
  /** Lower-cased TLD (last hostname label). Empty for IP/literal hosts. */
  tld: string;
  /** Path segments, '/' splits, no empty strings. */
  pathSegments: string[];
  /** Query parameters as ordered entries — keeps duplicates so ?a=1&a=2 round-trips. */
  searchParams: Array<{ key: string; value: string }>;
  /** True if the URL is absolute (has a protocol). */
  isAbsolute: boolean;
}

const UrlParseComponentStub = (): unknown => null;

export function parseUrl(input: string): UrlParseResult {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('url-parse requires a non-empty URL.');

  let url: URL;
  let isAbsolute: boolean;
  try {
    url = new URL(trimmed);
    isAbsolute = true;
  } catch {
    // Try treating as a relative URL by anchoring to a dummy base. We
    // strip the base back out so the caller sees just their input parsed.
    try {
      url = new URL(trimmed, 'https://wyreup.invalid');
      isAbsolute = false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not parse "${input}" as a URL: ${msg}`);
    }
  }

  const hostname = url.hostname;
  const tldMatch = /\.([a-z0-9-]+)$/i.exec(hostname);
  const tld = tldMatch && !/^\d+$/.test(tldMatch[1]!) ? tldMatch[1]!.toLowerCase() : '';

  const pathSegments = url.pathname.split('/').filter((s) => s !== '');

  const searchParams: Array<{ key: string; value: string }> = [];
  url.searchParams.forEach((value, key) => {
    searchParams.push({ key, value });
  });

  return {
    href: isAbsolute ? url.href : trimmed,
    protocol: isAbsolute ? url.protocol : '',
    username: url.username,
    password: url.password,
    host: isAbsolute ? url.host : '',
    hostname: isAbsolute ? hostname : '',
    port: isAbsolute ? url.port : '',
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    origin: isAbsolute ? url.origin : '',
    tld: isAbsolute ? tld : '',
    pathSegments,
    searchParams,
    isAbsolute,
  };
}

export const urlParse: ToolModule<UrlParseParams> = {
  id: 'url-parse',
  slug: 'url-parse',
  name: 'URL Parse',
  description:
    'Break a URL into its parts — protocol, host, port, path segments, query parameters, fragment. Handles relative URLs and preserves duplicate query keys.',
  category: 'inspect',
  presence: 'both',
  keywords: ['url', 'parse', 'query', 'host', 'path', 'protocol', 'fragment', 'split'],

  input: {
    accept: ['*/*'],
    min: 0,
    sizeLimit: 0,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultUrlParseParams,

  paramSchema: {
    url: {
      type: 'string',
      label: 'URL',
      placeholder: 'https://example.com/path?q=1#frag',
      multiline: false,
    },
  },

  Component: UrlParseComponentStub,

  async run(_inputs: File[], params: UrlParseParams, ctx: ToolRunContext): Promise<Blob[]> {
    const url = params.url ?? '';
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Parsing URL' });
    const result = parseUrl(url);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
