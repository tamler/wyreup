import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const packageDirectory =
  process.env.WYREUP_ASTRO_BASELINE_DIRECTORY ??
  path.dirname(require.resolve('astro/package.json'));
const manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
assert.equal(manifest.version, '7.3.7', 'Cache contract requires the exact reviewed Astro version');
const remoteFile = path.join(packageDirectory, 'dist/assets/build/remote.js');
const { loadRemoteImage, revalidateRemoteImage } = await import(pathToFileURL(remoteFile).href);
const source = 'https://images.example/image.png';
const validators = { etag: '"previous"', lastModified: 'Mon, 05 Oct 2026 10:00:00 GMT' };
const clock = 1_791_446_400_000;
const policies = [
  { 'Cache-Control': 'public, max-age=86400' },
  { 'Cache-Control': 'public, max-age=86400', 'Set-Cookie': 'private=value' },
  { 'Cache-Control': 'proxy-revalidate, max-age=0' },
  { 'Cache-Control': 'no-cache, max-age=86400' },
  { 'Cache-Control': 'no-store' },
];

test('remote helpers do not import or invoke the removed cache-policy dependency', async () => {
  const code = await readFile(remoteFile, 'utf8');
  assert.doesNotMatch(code, /http-cache-semantics|CachePolicy|webToCachePolicy/);
});

for (const headers of policies) {
  test(`200 images expire immediately with ${JSON.stringify(headers)}`, async (t) => {
    t.mock.method(Date, 'now', () => clock);
    const fetchImage = async (request, options) => {
      assert.equal(request.url, source);
      assert.equal(options.redirect, 'manual');
      return new Response('image bytes', { headers: { ...headers, Etag: '"new"' } });
    };
    const loaded = await loadRemoteImage(source, fetchImage);
    assert.equal(loaded.data.toString(), 'image bytes');
    assert.equal(loaded.expires, clock);
    assert.equal(loaded.etag, '"new"');
    const revalidated = await revalidateRemoteImage(source, validators, fetchImage);
    assert.equal(revalidated.data.toString(), 'image bytes');
    assert.equal(revalidated.expires, clock);
    assert.equal(revalidated.etag, '"new"');
    assert.equal(revalidated.lastModified, undefined);
  });

  test(`304 images retain validators and expire immediately with ${JSON.stringify(headers)}`, async (t) => {
    t.mock.method(Date, 'now', () => clock);
    const result = await revalidateRemoteImage(source, validators, async (request) => {
      assert.equal(request.headers.get('If-None-Match'), validators.etag);
      assert.equal(request.headers.get('If-Modified-Since'), validators.lastModified);
      return new Response(null, { status: 304, headers });
    });
    assert.equal(result.data, null);
    assert.equal(result.etag, validators.etag);
    assert.equal(result.lastModified, validators.lastModified);
    assert.equal(result.expires, clock);
  });
}

test('304 validators are updated when the server supplies replacements', async (t) => {
  t.mock.method(Date, 'now', () => clock);
  const result = await revalidateRemoteImage(
    source,
    validators,
    async () =>
      new Response(null, {
        status: 304,
        headers: { Etag: '"replacement"', 'Last-Modified': 'Tue, 06 Oct 2026 10:00:00 GMT' },
      }),
  );
  assert.equal(result.etag, '"replacement"');
  assert.equal(result.lastModified, 'Tue, 06 Oct 2026 10:00:00 GMT');
  assert.equal(result.expires, clock);
});

test('empty 200 revalidation retries the existing load path', async (t) => {
  t.mock.method(Date, 'now', () => clock);
  let calls = 0;
  const result = await revalidateRemoteImage(source, validators, async (request) => {
    calls++;
    if (calls === 1) {
      assert.equal(request.headers.get('If-None-Match'), validators.etag);
      return new Response(null);
    }
    assert.equal(request.headers.get('If-None-Match'), null);
    return new Response('retry bytes', { headers: { 'Cache-Control': 'public, max-age=86400' } });
  });
  assert.equal(calls, 2);
  assert.equal(result.data.toString(), 'retry bytes');
  assert.equal(result.expires, clock);
});

test('fetch and status errors still propagate without producing cache entries', async () => {
  const failure = new Error('controlled fetch failure');
  for (const operation of [
    (fetchImage) => loadRemoteImage(source, fetchImage),
    (fetchImage) => revalidateRemoteImage(source, validators, fetchImage),
  ]) {
    await assert.rejects(
      operation(async () => {
        throw failure;
      }),
      (error) => error === failure,
    );
  }
  await assert.rejects(
    loadRemoteImage(source, async () => new Response(null, { status: 404 })),
    /received 404/,
  );
  await assert.rejects(
    revalidateRemoteImage(source, validators, async () => new Response(null, { status: 503 })),
    /received 503/,
  );
  await assert.rejects(
    revalidateRemoteImage(source, validators, async () => new Response(null, { status: 300 })),
    /redirected/,
  );
});

test('remote redirect restrictions remain enforced', async (t) => {
  t.mock.method(Date, 'now', () => clock);
  const redirect = async () =>
    new Response(null, {
      status: 302,
      headers: { Location: 'https://unapproved.example/image.png' },
    });
  await assert.rejects(loadRemoteImage(source, redirect), /not an allowed remote location/);
  await assert.rejects(
    revalidateRemoteImage(source, validators, redirect),
    /not an allowed remote location/,
  );
  const requests = [];
  const result = await loadRemoteImage(
    source,
    async (request) => {
      requests.push(request.url);
      return requests.length === 1
        ? new Response(null, { status: 302, headers: { Location: '/approved.png' } })
        : new Response('redirected bytes');
    },
    { domains: ['images.example'], remotePatterns: [] },
  );
  assert.deepEqual(requests, [source, 'https://images.example/approved.png']);
  assert.equal(result.data.toString(), 'redirected bytes');
  assert.equal(result.expires, clock);
});
