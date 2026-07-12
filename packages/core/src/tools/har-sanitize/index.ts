import type { ToolModule, ToolRunContext } from '../../types.js';
import {
  defaultHarSanitizeParams,
  type HarSanitizeCounts,
  type HarSanitizeParams,
} from './types.js';

export type { HarSanitizeCounts, HarSanitizeParams } from './types.js';
export { defaultHarSanitizeParams } from './types.js';

const REDACTED = '[REDACTED]';
const SENSITIVE_QUERY_NAME = /token|key|secret|auth|session|password|signature/i;
const AUTH_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
]);

interface HarNameValue {
  name?: unknown;
  value?: unknown;
}

interface HarContent {
  text?: unknown;
}

interface HarSide {
  cookies?: unknown;
  headers?: unknown;
  queryString?: unknown;
  postData?: HarContent;
  url?: unknown;
  content?: HarContent;
}

interface HarEntry {
  request?: HarSide;
  response?: HarSide;
}

interface HarDocument {
  log?: {
    entries?: unknown;
    _sanitized?: HarSanitizeCounts;
  };
}

function redactNameValues(values: unknown, shouldRedact: (name: string) => boolean): number {
  if (!Array.isArray(values)) return 0;
  let count = 0;
  for (const item of values as HarNameValue[]) {
    if (typeof item?.name !== 'string' || !shouldRedact(item.name)) continue;
    if (item.value !== REDACTED) {
      item.value = REDACTED;
      count++;
    }
  }
  return count;
}

function redactUrlQuery(rawUrl: unknown): { url: unknown; count: number } {
  if (typeof rawUrl !== 'string') return { url: rawUrl, count: 0 };
  const queryStart = rawUrl.indexOf('?');
  if (queryStart < 0) return { url: rawUrl, count: 0 };

  const fragmentStart = rawUrl.indexOf('#', queryStart);
  const queryEnd = fragmentStart < 0 ? rawUrl.length : fragmentStart;
  let count = 0;
  const query = rawUrl
    .slice(queryStart + 1, queryEnd)
    .split('&')
    .map((part) => {
      const equals = part.indexOf('=');
      const rawName = equals < 0 ? part : part.slice(0, equals);
      let name = rawName;
      try {
        name = decodeURIComponent(rawName.replace(/\+/g, ' '));
      } catch {
        // Match malformed names as written while leaving the rest of the URL intact.
      }
      if (!SENSITIVE_QUERY_NAME.test(name)) return part;
      const rawValue = equals < 0 ? '' : part.slice(equals + 1);
      if (rawValue === encodeURIComponent(REDACTED)) return part;
      count++;
      return `${rawName}=${encodeURIComponent(REDACTED)}`;
    })
    .join('&');

  if (count === 0) return { url: rawUrl, count: 0 };
  return {
    url: `${rawUrl.slice(0, queryStart + 1)}${query}${rawUrl.slice(queryEnd)}`,
    count,
  };
}

function redactBody(container: HarContent | undefined): number {
  if (!container || typeof container.text !== 'string' || container.text === REDACTED) return 0;
  container.text = REDACTED;
  return 1;
}

function sanitizeHar(document: HarDocument, params: HarSanitizeParams): HarDocument {
  if (
    !document ||
    typeof document !== 'object' ||
    !document.log ||
    typeof document.log !== 'object'
  ) {
    throw new Error('Invalid HAR: expected a top-level log object.');
  }
  if (!Array.isArray(document.log.entries)) {
    throw new Error('Invalid HAR: expected log.entries to be an array.');
  }

  const counts: HarSanitizeCounts = {
    cookies: 0,
    authHeaders: 0,
    queryTokens: 0,
    postData: 0,
  };

  for (const entry of document.log.entries as HarEntry[]) {
    const request = entry?.request;
    const response = entry?.response;

    if (params.redactCookies ?? true) {
      counts.cookies += redactNameValues(request?.cookies, () => true);
      counts.cookies += redactNameValues(response?.cookies, () => true);
      counts.cookies += redactNameValues(
        request?.headers,
        (name) => name.toLowerCase() === 'cookie',
      );
      counts.cookies += redactNameValues(
        response?.headers,
        (name) => name.toLowerCase() === 'set-cookie',
      );
    }

    if (params.redactAuthHeaders ?? true) {
      counts.authHeaders += redactNameValues(request?.headers, (name) =>
        AUTH_HEADER_NAMES.has(name.toLowerCase()),
      );
      counts.authHeaders += redactNameValues(response?.headers, (name) =>
        AUTH_HEADER_NAMES.has(name.toLowerCase()),
      );
    }

    if (params.redactQueryTokens ?? true) {
      counts.queryTokens += redactNameValues(request?.queryString, (name) =>
        SENSITIVE_QUERY_NAME.test(name),
      );
      if (request) {
        const redactedUrl = redactUrlQuery(request.url);
        request.url = redactedUrl.url;
        counts.queryTokens += redactedUrl.count;
      }
    }

    if (params.redactPostData ?? false) {
      counts.postData += redactBody(request?.postData);
      counts.postData += redactBody(response?.content);
    }
  }

  document.log._sanitized = counts;
  return document;
}

export const harSanitize: ToolModule<HarSanitizeParams> = {
  id: 'har-sanitize',
  slug: 'har-sanitize',
  name: 'HAR Sanitizer',
  description:
    'Redact cookies, authentication headers, sensitive query values, and optionally request and response bodies from a HAR file without removing entries. This reduces common secret exposure but cannot identify every sensitive value.',
  llmDescription:
    'Sanitize a JSON HTTP Archive while preserving every log entry for DevTools import. It redacts cookie fields and headers, common authentication headers, query values whose parameter names look sensitive, and optionally all request postData.text and response content.text bodies. It does not detect secrets in arbitrary headers or body fields.',
  category: 'privacy',
  categories: ['privacy', 'dev'],
  keywords: [
    'har',
    'http archive',
    'sanitize',
    'redact',
    'cookies',
    'authorization',
    'query token',
    'privacy',
    'devtools',
  ],

  input: {
    accept: ['application/json', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: { mime: 'application/json', multiple: false },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',

  defaults: defaultHarSanitizeParams,

  paramSchema: {
    redactCookies: {
      type: 'boolean',
      label: 'redact cookies',
      help: 'Replace values in request and response cookie arrays and Cookie or Set-Cookie headers.',
    },
    redactAuthHeaders: {
      type: 'boolean',
      label: 'redact authentication headers',
      help: 'Replace Authorization, Proxy-Authorization, X-Api-Key, and X-Auth-Token header values.',
    },
    redactQueryTokens: {
      type: 'boolean',
      label: 'redact sensitive query values',
      help: 'Replace query values when the parameter name contains token, key, secret, auth, session, password, or signature.',
    },
    redactPostData: {
      type: 'boolean',
      label: 'redact request and response bodies',
      help: 'Replace every request postData.text and response content.text body, regardless of content.',
    },
  },

  async run(inputs: File[], params: HarSanitizeParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('har-sanitize accepts exactly one HAR file.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Reading HAR' });
    let document: HarDocument;
    try {
      document = JSON.parse(await inputs[0]!.text()) as HarDocument;
    } catch (error) {
      throw new Error(`Invalid HAR JSON: ${(error as Error).message}`);
    }

    const sanitized = sanitizeHar(document, params);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(sanitized, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
