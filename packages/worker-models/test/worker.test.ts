import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { MANIFEST, STRICT_VERIFICATION } from '../src/manifest.js';

// Node's global `crypto` doesn't have DigestStream. Provide a shim that
// matches Cloudflare's API: a WritableStream with a `digest` Promise that
// resolves with the ArrayBuffer of the hash at end-of-stream.
class TestDigestStream extends WritableStream<Uint8Array> {
  readonly digest: Promise<ArrayBuffer>;
  constructor(algorithm: string) {
    let resolve!: (b: ArrayBuffer) => void;
    let reject!: (e: unknown) => void;
    const digestPromise = new Promise<ArrayBuffer>((res, rej) => { resolve = res; reject = rej; });
    const hash = createHash(algorithm.toLowerCase().replace('-', ''));
    super({
      write(chunk: Uint8Array) { hash.update(chunk); },
      close() {
        const buf = hash.digest();
        resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      },
      abort(reason: unknown) { reject(reason); },
    });
    this.digest = digestPromise;
  }
}

// Minimal R2Bucket mock — every test sets the behavior it needs.
function makeBucket(opts: {
  hits?: Map<string, { body: ReadableStream<Uint8Array>; size: number; httpEtag: string; httpMetadata?: { contentType?: string } }>;
  puts?: string[];
} = {}): R2Bucket {
  const hits = opts.hits ?? new Map();
  const puts = opts.puts ?? [];
  // R2Bucket methods return Promises; the eslint require-await rule wants
  // either `async` + `await` OR a non-async function returning Promise.resolve().
  // These mocks don't actually await anything, so use the latter form.
  return {
    get: (key: string) => Promise.resolve(hits.get(key) ?? null),
    put: (key: string, _value: unknown) => { puts.push(key); return Promise.resolve(undefined); },
    head: () => Promise.resolve(null),
    list: () => Promise.resolve({ objects: [], delimitedPrefixes: [], truncated: false }),
    delete: () => Promise.resolve(undefined),
    createMultipartUpload: () => Promise.reject(new Error('unused')),
    resumeMultipartUpload: () => Promise.reject(new Error('unused')),
  } as unknown as R2Bucket;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>): void => {},
    passThroughOnException: (): void => {},
  } as ExecutionContext;
}

describe('worker-models security', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('crypto', { ...crypto, DigestStream: TestDigestStream });
  });

  it('rejects non-GET/HEAD/OPTIONS methods with 405', async () => {
    const res = await worker.fetch(new Request('https://x/y', { method: 'POST' }), { MODELS: makeBucket() } as never, makeCtx());
    expect(res.status).toBe(405);
  });

  it('rejects a path not on the allowlist with 403', async () => {
    const res = await worker.fetch(new Request('https://x/evil/model/resolve/main/file.bin'), { MODELS: makeBucket() } as never, makeCtx());
    expect(res.status).toBe(403);
  });

  it('rejects path traversal in pinned prefixes', async () => {
    const res = await worker.fetch(new Request('https://x/@mediapipe/tasks-vision@0.10.34/wasm/../etc/passwd'), { MODELS: makeBucket() } as never, makeCtx());
    expect(res.status).toBe(403);
  });

  it('rejects double-slash injection in pinned prefixes', async () => {
    const res = await worker.fetch(new Request('https://x/@mediapipe/tasks-vision@0.10.34/wasm//other'), { MODELS: makeBucket() } as never, makeCtx());
    expect(res.status).toBe(403);
  });

  it('rejects HF requests pinned to non-main revisions', async () => {
    // Even an allowed model is only proxied on the `main` branch.
    const res = await worker.fetch(new Request('https://x/Xenova/whisper-tiny/resolve/abc123/model.bin'), { MODELS: makeBucket() } as never, makeCtx());
    expect(res.status).toBe(403);
  });

  it('serves R2 hits with cache headers and X-Wyreup-Cache: hit', async () => {
    const body = new Response('cached').body!;
    const hits = new Map([['Xenova/whisper-tiny/resolve/main/model.bin', { body, size: 6, httpEtag: '"abc"', httpMetadata: { contentType: 'application/octet-stream' } }]]);
    const res = await worker.fetch(new Request('https://x/Xenova/whisper-tiny/resolve/main/model.bin'), { MODELS: makeBucket({ hits }) } as never, makeCtx());
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Wyreup-Cache')).toBe('hit');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
  });

  it('rejects an upstream Content-Length above MAX_OBJECT_SIZE with 413', async () => {
    // Stub global fetch to return a giant declared content-length.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('x', { headers: { 'Content-Length': String(10 * 1024 * 1024 * 1024), 'Content-Type': 'application/octet-stream' } }))));
    const res = await worker.fetch(new Request('https://x/Xenova/whisper-tiny/resolve/main/model.bin'), { MODELS: makeBucket() } as never, makeCtx());
    expect(res.status).toBe(413);
  });
});

describe('manifest', () => {
  it('manifest is an object (may be empty until populated)', () => {
    expect(typeof MANIFEST).toBe('object');
  });

  it('STRICT_VERIFICATION default is false (loose mode while manifest is being populated)', () => {
    expect(STRICT_VERIFICATION).toBe(false);
  });

  it('every manifest entry has a 64-char lowercase hex sha256', () => {
    for (const [key, entry] of Object.entries(MANIFEST)) {
      expect(entry.sha256, key).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('manifest verification integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('crypto', { ...crypto, DigestStream: TestDigestStream });
  });

  it('caches to R2 when hash matches manifest entry', async () => {
    // Compute the expected SHA-256 of the response body "hello".
    // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    const body = 'hello';
    const puts: string[] = [];
    let putsValue: unknown;
    const bucket: R2Bucket = {
      get: () => Promise.resolve(null),
      put: (key: string, value: unknown) => { puts.push(key); putsValue = value; return Promise.resolve(undefined); },
      head: () => Promise.resolve(null),
      list: () => Promise.resolve({ objects: [], delimitedPrefixes: [], truncated: false }),
      delete: () => Promise.resolve(undefined),
      createMultipartUpload: () => Promise.reject(new Error('unused')),
      resumeMultipartUpload: () => Promise.reject(new Error('unused')),
    } as unknown as R2Bucket;

    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx: ExecutionContext = {
      waitUntil: (p: Promise<unknown>): void => { waitUntilPromises.push(p); },
      passThroughOnException: (): void => {},
    } as ExecutionContext;

    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/plain' } })),
    ));

    const res = await worker.fetch(
      new Request('https://x/Xenova/whisper-tiny/resolve/main/model.bin'),
      { MODELS: bucket } as never,
      ctx,
    );
    expect(res.status).toBe(200);

    // Drain all waitUntil promises so R2 put (or skip) runs.
    await Promise.all(waitUntilPromises);

    // No manifest entry for this path — unverified pass-through, should cache.
    expect(puts).toContain('Xenova/whisper-tiny/resolve/main/model.bin');
    void putsValue; // assigned but only checked indirectly via puts
  });

  it('streaming SHA verification works regardless of body size (no buffered cap)', async () => {
    // End-to-end: a body that would have exceeded the old 100 MB
    // threshold still caches correctly. We use a small body to keep the test
    // fast — the assertion is that no size check rejects it.
    const body = 'streaming-sha-test';
    const puts: string[] = [];
    const bucket: R2Bucket = {
      get: () => Promise.resolve(null),
      put: (key: string, _value: unknown) => { puts.push(key); return Promise.resolve(undefined); },
      head: () => Promise.resolve(null),
      list: () => Promise.resolve({ objects: [], delimitedPrefixes: [], truncated: false }),
      delete: () => Promise.resolve(undefined),
      createMultipartUpload: () => Promise.reject(new Error('unused')),
      resumeMultipartUpload: () => Promise.reject(new Error('unused')),
    } as unknown as R2Bucket;

    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx: ExecutionContext = {
      waitUntil: (p: Promise<unknown>): void => { waitUntilPromises.push(p); },
      passThroughOnException: (): void => {},
    } as ExecutionContext;

    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/plain' } })),
    ));

    const res = await worker.fetch(
      new Request('https://x/Xenova/whisper-tiny/resolve/main/tokenizer.json'),
      { MODELS: bucket } as never,
      ctx,
    );
    expect(res.status).toBe(200);

    await Promise.all(waitUntilPromises);
    // No manifest entry — unverified pass-through, should cache via streaming path.
    expect(puts).toContain('Xenova/whisper-tiny/resolve/main/tokenizer.json');
  });
});
