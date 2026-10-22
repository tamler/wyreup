import type { PagesFunction } from '../_lib/types';
import { canonicalizeDomain } from '../../packages/core/src/lib/domain-registration';
import {
  acquireDomainIsolateSlot,
  DomainAdmissionError,
  reserveDomainLookup,
  type DomainLease,
} from '../_lib/public-rate-limit';
import { lookupDomainRegistration } from '../_lib/rdap';

function json(value: unknown, status = 200, retryAfter?: number): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (retryAfter !== undefined)
    headers.set('Retry-After', String(Math.max(1, Math.min(60, retryAfter))));
  return new Response(JSON.stringify(value), { status, headers });
}

function unavailable(): Response {
  return json({ error: 'Public lookup is temporarily unavailable.' }, 503, 1);
}

async function domainInput(request: Request, signal: AbortSignal): Promise<string> {
  if (
    !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
      request.headers.get('Content-Type') ?? '',
    ) ||
    !request.body
  )
    throw new Error('Invalid request.');
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 1024))
    throw new Error('Invalid request.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      try {
        void reader.cancel().catch(() => {});
      } catch {
        /* Cancellation is best effort. */
      }
      reject(new Error('Lookup canceled.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    if (signal.aborted) throw new Error('Lookup canceled.');
    while (true) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024) throw new Error('Invalid request.');
      chunks.push(next.value);
    }
    if (signal.aborted) throw new Error('Lookup canceled.');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).join(',') !== 'domain'
    )
      throw new Error('Invalid request.');
    return canonicalizeDomain((value as { domain: unknown }).domain);
  } finally {
    signal.removeEventListener('abort', onAbort);
    try {
      void reader.cancel().catch(() => {});
    } catch {
      /* A pending read can retain its lock. */
    }
    try {
      reader.releaseLock();
    } catch {
      /* Abandoned reads settle independently. */
    }
  }
}

export const onRequest: PagesFunction = (context) => {
  const controller = new AbortController();
  let timedOut = false;
  let finishDeadline: (response: Response) => void = () => {};
  const deadline = new Promise<Response>((resolve) => {
    finishDeadline = resolve;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    finishDeadline(unavailable());
  }, 10000);
  const request = context.request;
  const origin = request.headers.get('Origin');
  if (request.method !== 'POST' || (origin !== null && origin !== new URL(request.url).origin)) {
    clearTimeout(timer);
    return json(
      {
        error: request.method !== 'POST' ? 'Use POST for public lookup.' : 'Origin is not allowed.',
      },
      request.method !== 'POST' ? 405 : 403,
    );
  }
  let releaseSlot: () => void;
  try {
    releaseSlot = acquireDomainIsolateSlot();
  } catch {
    clearTimeout(timer);
    return unavailable();
  }
  const operation = (async () => {
    let lease: DomainLease | undefined;
    try {
      let domain: string;
      try {
        domain = await domainInput(request, controller.signal);
      } catch {
        return controller.signal.aborted
          ? unavailable()
          : json({ error: 'Enter one valid domain in a bounded JSON request.' }, 400);
      }
      const { DB, SESSION_SECRET } = context.env;
      const ip = request.headers.get('CF-Connecting-IP');
      if (!DB || !SESSION_SECRET || !ip || controller.signal.aborted) return unavailable();
      lease = await reserveDomainLookup(DB, SESSION_SECRET, ip, controller.signal);
      if (controller.signal.aborted) return unavailable();
      let providerRetryAfter = 60;
      const result = await lookupDomainRegistration(domain, controller.signal, undefined, undefined,
        seconds => { providerRetryAfter = seconds; });
      if (controller.signal.aborted) return unavailable();
      const serialized = JSON.stringify(result);
      if (new TextEncoder().encode(serialized).length > 16384) return unavailable();
      return json(result, 200, result.status === 'rate-limited' ? providerRetryAfter : undefined);
    } catch (error) {
      if (error instanceof DomainAdmissionError)
        return json({ error: error.message }, error.status, error.retryAfter);
      return unavailable();
    } finally {
      try {
        await lease?.release();
      } catch {
        /* An unreleased lease expires; no retry or provider work follows. */
      }
      releaseSlot();
    }
  })();
  context.waitUntil(
    operation.then(
      () => {},
      () => {},
    ),
  );
  return Promise.race([operation, deadline]).finally(() => {
    if (!timedOut) clearTimeout(timer);
  });
};
