import type { ToolModule, ParamFieldSchema, ToolRunContext } from '../types.js';
import { validateUtilityParams, type UtilityParams } from './common.js';

const schema: Record<string, ParamFieldSchema> = {
  domain: {
    type: 'string',
    label: 'Domain name',
    minLength: 1,
    maxLength: 253,
    help: 'The entered domain is sent to Wyreup, which reads the public IANA bootstrap and sends the domain to its registration registry. IANA does not receive the queried domain. No API key is required.',
  },
};

class PublicLookupError extends Error {}

function capacityMessage(response: Response): string {
  const header = response.headers.get('Retry-After') ?? '';
  const seconds = /^\d{1,2}$/.test(header) ? Number(header) : 0;
  const retry = seconds >= 1 && seconds <= 60
    ? `Try again in ${seconds} seconds.` : 'Try again later.';
  return `Public domain lookup capacity is temporarily limited. ${retry}`;
}

export function trustedDomainApiOrigin(ctx: Pick<ToolRunContext, 'proOrigin'>): string {
  const input =
    typeof window !== 'undefined'
      ? window.location.origin
      : (ctx.proOrigin ?? 'https://wyreup.com');
  const url = new URL(input);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Invalid trusted Wyreup API origin.');
  return url.origin;
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  try {
    void body?.cancel().catch(() => {});
  } catch {
    /* Cancellation is attempted, never awaited. */
  }
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (success: boolean, value: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      if (success) resolve(value as T);
      else reject(value instanceof Error ? value : new Error('Registration operation failed.'));
    };
    const aborted = () =>
      finish(false, new Error('Domain lookup cancelled or exceeded its deadline.'));
    signal.addEventListener('abort', aborted, { once: true });
    // Both handlers stay attached to absorb an abandoned late result or failure.
    void operation.then(
      (value) => finish(true, value),
      (cause) => finish(false, cause),
    );
    if (signal.aborted) aborted();
  });
}

async function readPublicResult(response: Response, signal: AbortSignal): Promise<unknown> {
  const media = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(media)) {
    cancelBody(response.body);
    throw new Error('Registration API returned an unexpected response type.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Registration API returned no body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let cancellationRequested = false;
  const cancelled = () => {
    if (cancellationRequested) return;
    cancellationRequested = true;
    try {
      void reader.cancel().catch(() => {});
    } catch {
      /* Owned reader cancellation is best effort. */
    }
  };
  signal.addEventListener('abort', cancelled, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new Error('Domain lookup cancelled or exceeded its deadline.');
      const item = await abortable(reader.read(), signal);
      if (signal.aborted) throw new Error('Domain lookup cancelled or exceeded its deadline.');
      if (item.done) break;
      size += item.value.byteLength;
      if (size > 16384) throw new Error('Registration API response exceeds 16 KiB.');
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } finally {
    signal.removeEventListener('abort', cancelled);
    cancelled();
    try {
      reader.releaseLock();
    } catch {
      /* A nonconforming pending reader may refuse release. */
    }
  }
}

export const domainAgeChecker: ToolModule<UtilityParams> = {
  id: 'domain-age-checker',
  slug: 'domain-age-checker',
  name: 'Domain Registration Age',
  description:
    'The entered domain is sent to Wyreup, which reads the public IANA bootstrap and sends the domain to its registration registry. Reports registration age, which can differ from first-ever use. No API key is required.',
  llmDescription:
    'Network lookup: sends the entered domain to Wyreup and then its public registration registry. Wyreup reads the fixed IANA bootstrap without sending IANA the queried domain. No API key required; registration age may differ from first-ever use.',
  category: 'dev',
  keywords: ['domain', 'registration', 'rdap', 'age'],
  input: { accept: [], min: 0, max: 0 },
  output: { mime: 'application/json', multiple: false },
  defaults: { domain: '' },
  paramSchema: schema,
  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',
  surfaces: ['web', 'cli', 'mcp'],
  async run(inputs, provided, ctx) {
    const controller = new AbortController();
    const cancelled = () => controller.abort();
    ctx.signal.addEventListener('abort', cancelled, { once: true });
    const deadline = setTimeout(cancelled, 10000);
    try {
      if (ctx.signal.aborted) controller.abort();
      if (controller.signal.aborted) throw new Error('Domain lookup cancelled.');
      if (inputs.length) throw new PublicLookupError('Domain lookup accepts no files.');
      if (controller.signal.aborted)
        throw new Error('Domain lookup cancelled or exceeded its deadline.');
      const { canonicalizeDomain, validateDomainRegistration } = await abortable(
        import('../lib/domain-registration.js'),
        controller.signal,
      );
      if (controller.signal.aborted)
        throw new Error('Domain lookup cancelled or exceeded its deadline.');
      let domain: string;
      try {
        const params = validateUtilityParams(domainAgeChecker.defaults, schema, provided);
        domain = canonicalizeDomain(params.domain);
      } catch {
        throw new PublicLookupError(
          'Enter one valid public domain name, without a URL, port or credentials.',
        );
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new PublicLookupError('Domain registration lookup requires a network connection.');
      }
      const endpoint = new URL('/api/domain-age', trustedDomainApiOrigin(ctx));
      ctx.onProgress({
        stage: 'processing',
        percent: 10,
        message: 'Querying public registration data through Wyreup',
      });
      if (controller.signal.aborted)
        throw new Error('Domain lookup cancelled or exceeded its deadline.');
      const transport = fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: controller.signal,
      });
      const response = await abortable(
        transport.then((value) => {
          if (controller.signal.aborted) cancelBody(value.body);
          return value;
        }),
        controller.signal,
      );
      if (controller.signal.aborted)
        throw new Error('Domain lookup cancelled or exceeded its deadline.');
      if (response.status !== 200) {
        cancelBody(response.body);
        if (response.status === 429) {
          throw new PublicLookupError(capacityMessage(response));
        }
        if (response.status === 503)
          throw new PublicLookupError('Public domain lookup is temporarily unavailable.');
        throw new Error('Registration API rejected the lookup.');
      }
      const result = validateDomainRegistration(
        await readPublicResult(response, controller.signal),
        domain,
      );
      if (result.status === 'rate-limited') throw new PublicLookupError(capacityMessage(response));
      if (result.status === 'provider-error')
        throw new PublicLookupError('Public domain lookup is temporarily unavailable.');
      if (controller.signal.aborted)
        throw new Error('Domain lookup cancelled or exceeded its deadline.');
      const output = new Blob([JSON.stringify(result)], { type: 'application/json' });
      ctx.onProgress({ stage: 'done', percent: 100 });
      if (controller.signal.aborted)
        throw new Error('Domain lookup cancelled or exceeded its deadline.');
      return [output];
    } catch (cause) {
      if (controller.signal.aborted)
        throw new Error('Domain lookup cancelled or exceeded its deadline.');
      if (cause instanceof PublicLookupError) throw cause;
      throw new Error('Domain lookup failed. Check the domain or try again later.');
    } finally {
      clearTimeout(deadline);
      ctx.signal.removeEventListener('abort', cancelled);
    }
  },
  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/json'] },
};
