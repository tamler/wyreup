import manifest from '../../core/src/lib/onnx-assets.json';

type Asset = { file: string; bytes: number; sha256: string; version: string };

const pinned = new Map<string, Asset>(
  manifest.runtimes.flatMap((runtime) =>
    runtime.assets.map(
      (asset) =>
        [
          `onnxruntime-web@${runtime.version}/dist/${asset.file}`,
          { ...asset, version: runtime.version },
        ] as const,
    ),
  ),
);

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function verified(object: R2Object, asset: Asset): boolean {
  return (
    object.size === asset.bytes &&
    object.checksums.sha256 !== undefined &&
    hex(object.checksums.sha256) === asset.sha256
  );
}

function failure(): Response {
  return new Response('Pinned runtime asset verification failed', {
    status: 502,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function response(request: Request, object: R2ObjectBody, asset: Asset, cache: string): Response {
  const headers = {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'CDN-Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': asset.file.endsWith('.wasm') ? 'application/wasm' : 'application/javascript',
    'Content-Length': String(asset.bytes),
    ETag: object.httpEtag,
    'X-Wyreup-Cache': cache,
    'X-Wyreup-Verified': asset.sha256,
    'X-Wyreup-Runtime-Version': asset.version,
  };
  if (request.method === 'HEAD') {
    void object.body.cancel().catch(() => {});
    return new Response(null, { headers });
  }
  return new Response(object.body, { headers });
}

/** Separate from legacy model streaming: no executable bytes escape validation. */
export async function pinnedRuntime(
  request: Request,
  key: string,
  bucket: R2Bucket,
): Promise<Response> {
  const asset = pinned.get(key);
  if (!asset)
    return new Response('Forbidden runtime asset', {
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
    });
  let untrusted = false;
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
  try {
    const existing = await bucket.get(key);
    if (existing && verified(existing, asset)) return response(request, existing, asset, 'hit');
    untrusted = existing !== null;
    let body: ReadableStream<Uint8Array>;
    if (existing) {
      if (existing.size !== asset.bytes) {
        await existing.body.cancel();
        throw new Error('Untrusted runtime size mismatch');
      }
      body = existing.body as ReadableStream<Uint8Array>;
    } else {
      const upstream = await fetch(`https://cdn.jsdelivr.net/npm/${key}`, {
        headers: { 'Accept-Encoding': 'identity' },
        redirect: 'manual',
        signal,
      });
      const encoding = upstream.headers.get('Content-Encoding');
      const size = upstream.headers.get('Content-Length');
      if (
        upstream.status !== 200 ||
        !upstream.body ||
        (encoding && encoding !== 'identity') ||
        (size !== null && (!/^\d+$/.test(size) || Number(size) !== asset.bytes))
      ) {
        await upstream.body?.cancel();
        throw new Error('Upstream runtime response mismatch');
      }
      body = upstream.body;
    }
    const stream = new FixedLengthStream(asset.bytes);
    const digest = Uint8Array.from(asset.sha256.match(/../g) ?? [], (pair) =>
      Number.parseInt(pair, 16),
    ).buffer;
    const pipe = body.pipeTo(stream.writable, { signal });
    const put = Promise.resolve().then(() =>
      bucket.put(key, stream.readable, {
        sha256: digest,
        httpMetadata: {
          contentType: asset.file.endsWith('.wasm') ? 'application/wasm' : 'application/javascript',
        },
        customMetadata: { sha256: asset.sha256, runtimeVersion: asset.version },
      }),
    );
    try {
      const [, stored] = await Promise.all([pipe, put]);
      if (!stored || !verified(stored, asset)) throw new Error('Runtime PUT did not verify');
    } catch (error) {
      controller.abort();
      await Promise.allSettled([pipe, put]);
      throw error;
    }
    const object = await bucket.get(key);
    if (!object || !verified(object, asset)) {
      await object?.body.cancel();
      throw new Error('Published runtime object did not verify');
    }
    return response(request, object, asset, 'miss');
  } catch {
    controller.abort();
    if (untrusted) {
      // Retain a concurrent successful write; delete only a still-untrusted key.
      // R2 has no conditional delete, so a remaining availability race retries cold.
      const current = await bucket.head(key).catch(() => null);
      if (!current || !verified(current, asset)) await bucket.delete(key).catch(() => {});
    }
    return failure();
  }
}
