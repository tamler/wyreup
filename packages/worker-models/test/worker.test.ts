import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index.js';

// Minimal R2Bucket mock — every test sets the behavior it needs.
function makeBucket(opts: {
  hits?: Map<string, { body: ReadableStream<Uint8Array>; size: number; httpEtag: string; httpMetadata?: { contentType?: string } }>;
  puts?: string[];
} = {}): R2Bucket {
  const hits = opts.hits ?? new Map();
  const puts = opts.puts ?? [];
  return {
    async get(key: string) { return hits.get(key) ?? null; },
    async put(key: string, _value: unknown) { puts.push(key); return undefined; },
    async head() { return null; },
    async list() { return { objects: [], delimitedPrefixes: [], truncated: false }; },
    async delete() { return undefined; },
    async createMultipartUpload() { throw new Error('unused'); },
    async resumeMultipartUpload() { throw new Error('unused'); },
  } as unknown as R2Bucket;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as ExecutionContext;
}

describe('worker-models security', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

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
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { headers: { 'Content-Length': String(10 * 1024 * 1024 * 1024), 'Content-Type': 'application/octet-stream' } })));
    const res = await worker.fetch(new Request('https://x/Xenova/whisper-tiny/resolve/main/model.bin'), { MODELS: makeBucket() } as never, makeCtx());
    expect(res.status).toBe(413);
  });
});
