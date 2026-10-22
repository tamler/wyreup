import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';
import {
  asciiStl,
  binaryStl,
  box,
  hollowBox,
} from '../../core/test/fixtures/catalog-files/stl-fixtures';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => {
  harness = await openBrowserHarness('./test/fixtures/StlHarness.svelte', { fileWorker: true });
}, 30000);
afterAll(async () => {
  await harness?.close();
});
async function uploaded(
  page: Awaited<ReturnType<typeof harness.browser.newPage>>,
  bytes: Uint8Array,
) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Drop file or click to browse' }).click();
  await (
    await chooser
  ).setFiles({ name: 'original.stl', mimeType: 'model/stl', buffer: Buffer.from(bytes) });
}
async function artifact(page: Awaited<ReturnType<typeof harness.browser.newPage>>) {
  const event = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download all-layer contour G-code' }).click();
  const download = await event;
  expect(download.suggestedFilename()).toBe('contour-preview.gcode');
  const path = await download.path();
  if (!path) throw new Error('STL artifact download missing.');
  return readFile(path, 'utf8');
}
function planesAndLoops(text: string, feed = 1200) {
  const result: { z: number; loops: number[][][] }[] = [];
  let loop: number[][] = [];
  for (const line of text.trimEnd().split('\n')) {
    if (line.startsWith(';') || line === 'G21' || line === 'G90') continue;
    const z = /^G0 Z(\d+(?:\.\d+)?)$/.exec(line);
    if (z) {
      result.push({ z: Number(z[1]), loops: [] });
      continue;
    }
    const xy = /^G([01]) X(\d+(?:\.\d+)?) Y(\d+(?:\.\d+)?)(?: F(\d+))?$/.exec(line);
    expect(xy).not.toBeNull();
    if (xy![1] === '0') {
      loop = [];
      result.at(-1)!.loops.push(loop);
    } else expect(Number(xy![4])).toBe(feed);
    loop.push([Number(xy![2]), Number(xy![3])]);
  }
  for (const layer of result) for (const loop of layer.loops) expect(loop.at(-1)).toEqual(loop[0]);
  return result;
}
it('actual worker cube, layer SVG and invariant full download on a narrow screen', async () => {
  const page = await harness.browser.newPage({ viewport: { width: 375, height: 812 } }),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(harness.url);
    await uploaded(page, asciiStl(box()));
    await page.getByRole('button', { name: 'Generate contour preview' }).click();
    await page.getByRole('link', { name: 'Download all-layer contour G-code' }).waitFor();
    expect(await page.getByRole('img').getAttribute('aria-label')).toContain('Z 1');
    expect(await page.locator('polygon').getAttribute('points')).toBe('0,0 10,0 10,10 0,10');
    const first = await artifact(page);
    expect(planesAndLoops(first).map((l) => l.z)).toEqual([1, 3, 5, 7, 9]);
    await page.getByLabel('Preview layer').selectOption('4');
    expect(await page.getByRole('img').getAttribute('aria-label')).toContain('Z 9');
    expect(await artifact(page)).toBe(first);
    expect(planesAndLoops(first)[0].loops).toEqual([
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Unmount runner' }).click();
    expect(await page.getByRole('link').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 30000);
it('actual worker hollow contours, header safety, error clears previous output', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    await uploaded(page, asciiStl(hollowBox()));
    await page.getByRole('button', { name: 'Generate contour preview' }).click();
    await page.getByRole('link', { name: 'Download all-layer contour G-code' }).waitFor();
    expect(await page.locator('polygon').count()).toBe(2);
    expect(await page.locator('polygon.hole').getAttribute('points')).toBe('3,3 7,3 7,7 3,7');
    expect(await page.getByText(/net area 84.000000/).count()).toBe(1);
    expect(planesAndLoops(await artifact(page))[0].loops).toHaveLength(2);
    await uploaded(page, binaryStl(box(), 'solid secret-header\nM104 S300\n'));
    expect(await page.getByRole('link').count()).toBe(0);
    await page.getByRole('button', { name: 'Generate contour preview' }).click();
    await page.getByRole('link').waitFor();
    expect(await artifact(page)).not.toMatch(/M104|secret-header/);
    await uploaded(page, asciiStl(box().slice(1)));
    await page.getByRole('button', { name: 'Generate contour preview' }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').textContent()).toContain('Open mesh');
    expect(await page.getByRole('link').count()).toBe(0);
  } finally {
    await page.close();
  }
}, 30000);
it('actual worker cancellation/unmount does not publish stale output', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    const many = Array.from({ length: 200 }, (_, i) =>
      box(0, i * 0.9, 0, 0.5, i * 0.9 + 0.5, 1),
    ).flat();
    await uploaded(page, asciiStl(many));
    await page.getByRole('button', { name: 'Generate contour preview' }).click();
    await page.getByRole('button', { name: 'Cancel conversion' }).click();
    expect(await page.getByRole('link').count()).toBe(0);
    expect(await page.getByRole('alert').count()).toBe(0);
    await page.getByRole('button', { name: 'Generate contour preview' }).click();
    await page.getByRole('button', { name: 'Unmount runner' }).click();
    expect(await page.getByRole('link').count()).toBe(0);
  } finally {
    await page.close();
  }
}, 30000);
it('actual worker uses chosen inch units and feed with a visible partial top', async () => {
  const page = await harness.browser.newPage();
  page.setDefaultTimeout(5000);
  try {
    await page.goto(harness.url);
    await page.getByLabel('STL coordinate units').selectOption({ label: 'Inches' });
    await page.getByLabel('Contour feed (mm/min)').fill('1300');
    await uploaded(page, asciiStl(box(0, 0, 0, 1, 1, 1)));
    await page.getByRole('button', { name: 'Generate contour preview' }).click();
    await page.getByRole('link', { name: 'Download all-layer contour G-code' }).waitFor();
    expect(await page.getByText(/net area 645.160000/).count()).toBe(1);
    expect(await page.getByText(/Partial top excluded: 1.400000 mm/).count()).toBe(1);
    const layers = planesAndLoops(await artifact(page), 1300);
    expect(layers.map((layer) => layer.z)).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23]);
    expect(layers[0].loops[0]).toEqual([
      [0, 0],
      [25.4, 0],
      [25.4, 25.4],
      [0, 25.4],
      [0, 0],
    ]);
  } finally {
    await page.close();
  }
}, 30000);
