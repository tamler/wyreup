import type { ToolModule, ToolRunContext } from '../../types.js';

export interface UrlBuildSpec {
  protocol?: string;
  username?: string;
  password?: string;
  hostname?: string;
  port?: string | number;
  pathname?: string;
  searchParams?: Array<{ key: string; value: string }> | Record<string, string | number | boolean>;
  hash?: string;
}

export interface UrlBuildParams {
  /** JSON object describing the URL parts. Designed to round-trip with url-parse output. */
  spec?: string;
}

export const defaultUrlBuildParams: UrlBuildParams = {
  spec: '',
};

export interface UrlBuildResult {
  href: string;
  spec: UrlBuildSpec;
}

function normalizeProtocol(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) return 'https:';
  return trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
}

export function buildUrl(spec: UrlBuildSpec): string {
  if (!spec.hostname || spec.hostname.trim() === '') {
    throw new Error('url-build requires a hostname.');
  }
  const protocol = normalizeProtocol(spec.protocol ?? 'https');
  const auth = spec.username
    ? `${encodeURIComponent(spec.username)}${spec.password ? ':' + encodeURIComponent(spec.password) : ''}@`
    : '';
  const port = spec.port !== undefined && spec.port !== '' ? `:${spec.port}` : '';
  const path = spec.pathname && spec.pathname.startsWith('/')
    ? spec.pathname
    : spec.pathname
      ? '/' + spec.pathname
      : '/';
  const base = `${protocol}//${auth}${spec.hostname}${port}${path}`;

  // Build searchParams. Accept either an array of {key,value} entries (the
  // shape url-parse emits, preserves duplicates) or a plain object.
  const params = new URLSearchParams();
  if (Array.isArray(spec.searchParams)) {
    for (const { key, value } of spec.searchParams) {
      if (key === undefined) continue;
      params.append(String(key), String(value ?? ''));
    }
  } else if (spec.searchParams && typeof spec.searchParams === 'object') {
    for (const [k, v] of Object.entries(spec.searchParams)) {
      params.append(k, String(v));
    }
  }
  const query = params.toString();
  const search = query ? `?${query}` : '';

  let hash = spec.hash ?? '';
  if (hash && !hash.startsWith('#')) hash = `#${hash}`;

  // Run the assembled URL through the constructor so we get the same
  // normalization the WHATWG parser applies (lowercased host, default
  // port stripping, percent-encoding fixes).
  const u = new URL(`${base}${search}${hash}`);
  return u.href;
}

export const urlBuild: ToolModule<UrlBuildParams> = {
  id: 'url-build',
  slug: 'url-build',
  name: 'URL Build',
  description:
    'Assemble a URL from JSON parts (protocol, hostname, port, path, searchParams, hash). Round-trips with url-parse — parse a URL, edit the JSON, build it back.',
  category: 'create',
  keywords: ['url', 'build', 'compose', 'assemble', 'query', 'construct'],

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

  defaults: defaultUrlBuildParams,

  paramSchema: {
    spec: {
      type: 'string',
      label: 'URL spec (JSON)',
      help: 'JSON with hostname (required) and any of: protocol, username, password, port, pathname, searchParams, hash. Accepts the output shape of url-parse.',
      placeholder: '{"protocol":"https","hostname":"example.com","pathname":"/a","searchParams":[{"key":"q","value":"hi"}]}',
      multiline: true,
    },
  },

  async run(_inputs: File[], params: UrlBuildParams, ctx: ToolRunContext): Promise<Blob[]> {
    const raw = (params.spec ?? '').trim();
    if (!raw) throw new Error('url-build requires a JSON spec.');
    let spec: UrlBuildSpec;
    try {
      spec = JSON.parse(raw) as UrlBuildSpec;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`URL spec is not valid JSON: ${msg}`);
    }
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Building URL' });
    const href = buildUrl(spec);
    const result: UrlBuildResult = { href, spec };
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
