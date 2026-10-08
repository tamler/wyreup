import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function verifyRuntimeResponse(response, runtime, asset, requireHit = false) {
  try {
    assert.equal(response.status, 200, `Runtime asset failed: ${runtime.version}/${asset.file}`);
    assert.equal(response.headers.get('X-Wyreup-Verified'), asset.sha256);
    assert.equal(response.headers.get('X-Wyreup-Runtime-Version'), runtime.version);
    if (requireHit) assert.equal(response.headers.get('X-Wyreup-Cache'), 'hit');
    assert(response.body, 'Runtime asset has no body');
    const digest = createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      assert(bytes <= asset.bytes, 'Runtime asset exceeds its pinned length');
      digest.update(chunk);
    }
    assert.equal(bytes, asset.bytes, 'Runtime asset length differs from its pin');
    assert.equal(digest.digest('hex'), asset.sha256, 'Runtime asset checksum differs from its pin');
  } finally {
    await response.body?.cancel().catch(() => {});
  }
}

export async function checkRuntimeAssets(inventory, fetchAsset = fetch) {
  let checked = 0;
  for (const runtime of inventory.runtimes) {
    for (const asset of runtime.assets) {
      const url = `https://models.wyreup.com/onnxruntime-web@${runtime.version}/dist/${asset.file}`;
      const request = () =>
        fetchAsset(url, {
          redirect: 'error',
          signal: AbortSignal.timeout(180_000),
        });
      await verifyRuntimeResponse(await request(), runtime, asset);
      await verifyRuntimeResponse(await request(), runtime, asset, true);
      console.log(`Verified runtime bytes and R2 hit: ${runtime.version}/${asset.file}`);
      checked++;
    }
  }
  assert.equal(checked, 16, 'Expected both complete pinned ONNX runtime inventories');
  return checked;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const inventory = JSON.parse(
    await readFile(new URL('../packages/core/src/lib/onnx-assets.json', import.meta.url), 'utf8'),
  );
  await checkRuntimeAssets(inventory);
}
