import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const coreUrl = new URL('../../packages/core/dist/node/index.js', import.meta.url);
const requireCore = createRequire(coreUrl);
const { createCanvas, loadImage } = requireCore('@napi-rs/canvas');
const fixtureUrl = new URL('../../packages/core/test/fixtures/catalog-composite.psd', import.meta.url);
const context = (signal = new AbortController().signal) => ({ signal, cache: new Map(), executionId: crypto.randomUUID(), onProgress() {} });

for (const format of ['esm', 'cjs']) {
  test(`actual ${format} owned CSV worker returns the complete CSV artifact`, async () => {
    const core = format === 'esm' ? await import(coreUrl.href) : requireCore('./index.cjs');
    const source = 'name,count\r\n"two, commas",2\r\n"line\ninside",03\r\n';
    const output = await core.csvViewer.run([new File([source], 'fixture.csv', { type: 'text/csv' })], { delimiter: 'comma' }, context());
    assert.equal(output.length, 1);
    assert.equal(output[0].type, 'text/csv');
    assert.equal(await output[0].text(), source);
  });

  test(`actual ${format} owned PSD worker returns full-resolution PNG pixels`, async () => {
    const core = format === 'esm' ? await import(coreUrl.href) : requireCore('./index.cjs');
    const output = await core.psdToPng.run([new File([await readFile(fixtureUrl)], 'original.psd')], {}, context());
    assert.equal(output.length, 1);
    assert.equal(output[0].type, 'image/png');
    const bytes = new Uint8Array(await output[0].arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const image = await loadImage(Buffer.from(bytes));
    assert.equal(image.width, 2);
    assert.equal(image.height, 2);
    const canvas = createCanvas(2, 2), ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    assert.deepEqual([...ctx.getImageData(0, 0, 2, 2).data], [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  });

  test(`actual ${format} owned STL worker exports every contour layer`, async () => {
    const core = format === 'esm' ? await import(coreUrl.href) : requireCore('./index.cjs');
    const input = await readFile(new URL('../../packages/core/test/fixtures/catalog-files/stl-cube.stl', import.meta.url));
    const output = await core.stlToGcode.run([new File([input], 'cube.stl')], { layerHeightMm: 2 }, context());
    assert.equal(output.length, 1);
    assert.equal(output[0].type, 'text/plain');
    const artifact = await output[0].text();
    assert.deepEqual([...artifact.matchAll(/^G0 Z(.+)$/gm)].map(match => Number(match[1])), [1, 3, 5, 7, 9]);
    assert.equal([...artifact.matchAll(/^; layer /gm)].length, 5);
    assert.equal(artifact.includes('G0 X0 Y0'), true);
    assert.equal(artifact.includes('G1 X10 Y10 F1200'), true);
    assert.equal(/^[^;\n]*(?:E\d|M10[49]|G28)/m.test(artifact), false);
  });
}

test('packaged file jobs reject invalid PSD and isolate an already cancelled invocation', async () => {
  const core = await import(coreUrl.href);
  const controller = new AbortController();
  controller.abort();
  const file = new File([await readFile(fixtureUrl)], 'original.psd');
  await assert.rejects(core.psdToPng.run([file], {}, context(controller.signal)), /cancelled/);
  await assert.rejects(core.psdToPng.run([new File(['not a PSD'], 'spoof.psd')], {}, context()), /complete|PSD/);
  const output = await core.psdToPng.run([file], {}, context());
  assert.equal(output[0].type, 'image/png');
});
