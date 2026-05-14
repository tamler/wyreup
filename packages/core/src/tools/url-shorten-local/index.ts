import type { ToolModule, ToolRunContext } from '../../types.js';
import { encodeBase32 } from '../base32/index.js';

export interface UrlShortenLocalParams {
  url?: string;
  /** Slug length in characters (each base32 char = 5 bits of entropy). */
  slugLength?: number;
  /** Short-URL prefix. Defaults to a placeholder so the output is copy-pasteable. */
  prefix?: string;
  /** Also render a scannable QR PNG of the short URL. */
  emitQr?: boolean;
  qrSize?: number;
}

export const defaultUrlShortenLocalParams: UrlShortenLocalParams = {
  url: '',
  slugLength: 8,
  prefix: 'https://wyreup.app/',
  emitQr: false,
  qrSize: 256,
};

export interface UrlShortenLocalResult {
  url: string;
  slug: string;
  shortUrl: string;
  /** Bits of slug entropy. Useful when comparing slug lengths for collision risk. */
  slugBits: number;
}

const UrlShortenLocalComponentStub = (): unknown => null;

export async function shortenUrl(
  url: string,
  slugLength: number,
  prefix: string,
): Promise<UrlShortenLocalResult> {
  if (!url.trim()) throw new Error('url-shorten-local requires a URL.');
  // Canonicalize the URL through the WHATWG parser so trivial differences
  // (trailing slash, default ports, query order untouched but encoded) hash
  // consistently. Skip canonicalization for non-URL inputs — let the caller
  // hash arbitrary strings if they want.
  let canonical = url.trim();
  try {
    canonical = new URL(canonical).href;
  } catch {
    // Leave as-is; the hash works on any string.
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const bytes = new Uint8Array(digest);
  // base32 of the full digest, then truncate to `slugLength` chars. Each
  // base32 character carries 5 bits of entropy.
  const fullSlug = encodeBase32(bytes, false, true).toLowerCase();
  const slug = fullSlug.slice(0, slugLength);
  const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return {
    url: canonical,
    slug,
    shortUrl: `${normalizedPrefix}${slug}`,
    slugBits: slug.length * 5,
  };
}

export const urlShortenLocal: ToolModule<UrlShortenLocalParams> = {
  id: 'url-shorten-local',
  slug: 'url-shorten-local',
  name: 'URL Shorten (Local)',
  description:
    'Deterministic local URL shortener. SHA-256 the URL, base32-encode the digest, truncate to a slug. No server, no database — same URL always produces the same slug, so two clients can mint matching short links without coordination. Optional QR PNG of the short URL.',
  category: 'create',
  presence: 'both',
  keywords: ['url', 'shorten', 'short', 'link', 'slug', 'qr', 'local', 'hash'],

  input: {
    accept: ['*/*'],
    min: 0,
    sizeLimit: 0,
  },
  output: {
    mime: 'application/json',
    multiple: true,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultUrlShortenLocalParams,

  paramSchema: {
    url: {
      type: 'string',
      label: 'URL',
      placeholder: 'https://example.com/very/long/path?with=lots&of=params',
    },
    slugLength: {
      type: 'number',
      label: 'slug length',
      help: 'Each character carries 5 bits of entropy. 6 chars = 30 bits (~1B), 8 chars = 40 bits (~1T).',
      min: 4,
      max: 32,
      step: 1,
    },
    prefix: {
      type: 'string',
      label: 'short URL prefix',
      placeholder: 'https://wyreup.app/',
    },
    emitQr: {
      type: 'boolean',
      label: 'render QR',
      help: 'Produce a QR PNG of the short URL alongside the JSON.',
    },
    qrSize: {
      type: 'number',
      label: 'QR size',
      min: 100,
      max: 1000,
      step: 50,
      unit: 'px',
    },
  },

  Component: UrlShortenLocalComponentStub,

  async run(_inputs: File[], params: UrlShortenLocalParams, ctx: ToolRunContext): Promise<Blob[]> {
    const slugLength = Math.max(4, Math.min(32, params.slugLength ?? 8));
    const prefix = params.prefix ?? defaultUrlShortenLocalParams.prefix!;

    ctx.onProgress({ stage: 'processing', percent: 40, message: 'Hashing' });
    const result = await shortenUrl(params.url ?? '', slugLength, prefix);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const outputs: Blob[] = [
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
    ];

    if (params.emitQr ?? false) {
      ctx.onProgress({ stage: 'processing', percent: 75, message: 'Rendering QR' });
      const QRCode = await import('qrcode');
      const buffer = await QRCode.toBuffer(result.shortUrl, {
        errorCorrectionLevel: 'M',
        width: params.qrSize ?? 256,
      });
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
      outputs.push(new Blob([arrayBuffer], { type: 'image/png' }));
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return outputs;
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json', 'image/png'],
  },
};
