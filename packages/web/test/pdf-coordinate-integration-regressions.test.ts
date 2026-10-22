import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from '../../core/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { buildProductionCatalogFixture, serveBuiltCatalog } from './productionBrowserHarness';

type PageSpec = { origin: [number, number]; size: [number, number]; rotation: number; target: [number, number, number, number] };
type Fixture = { filename: string; bytes: number; sha256: string; pages: PageSpec[] };
type DecoderCanvasFactory = { create(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } };
function decoderCanvasFactory(factory: object): DecoderCanvasFactory {
  if (!('create' in factory) || typeof factory.create !== 'function') throw new Error('Independent PDF decoder canvas factory unavailable.');
  return factory as DecoderCanvasFactory;
}
let browser: Browser;
let server: Awaited<ReturnType<typeof serveBuiltCatalog>>;
let evidenceDir: string;
let distDir: string;
let fixture: Awaited<ReturnType<typeof buildProductionCatalogFixture>> | undefined;
let fixtures: Fixture[];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
beforeAll(async () => {
  evidenceDir = await realpath(await mkdtemp(join(tmpdir(), 'wyreup-pdf-coordinates-')));
  if (process.env.WYREUP_CATALOG_DIST) distDir = await realpath(process.env.WYREUP_CATALOG_DIST);
  else {
    fixture = await buildProductionCatalogFixture({ webDir: fileURLToPath(new URL('..', import.meta.url)), evidenceDir });
    distDir = fixture.distDir;
  }
  const provenance: unknown = JSON.parse(await readFile(fileURLToPath(new URL('./fixtures/pdf-coordinate/provenance.json', import.meta.url)), 'utf8'));
  if (typeof provenance !== 'object' || provenance === null || !('outputs' in provenance) || !Array.isArray(provenance.outputs)) throw new Error('Fixture provenance unavailable.');
  fixtures = provenance.outputs as Fixture[];
  server = await serveBuiltCatalog({ distDir, headersFile: join(distDir, '_headers'), deadlineAt: Date.now() + 120000 });
  browser = await chromium.launch({ headless: true });
}, 240000);
afterAll(async () => {
  const settled = await Promise.allSettled([browser?.close(), server?.close(), fixture?.close()]);
  const errors = settled.filter(result => result.status === 'rejected').map(result => result.reason as unknown);
  if (errors.length) throw new AggregateError(errors, 'Owned PDF coordinate cleanup failed.');
}, 15000);

// Independent canonical PDF-point to rotated visible-page fractions. No runner
// helper or production converter is used to derive these fixture coordinates.
function visibleRectangle(spec: PageSpec): [number, number, number, number] {
  const [originX, originY] = spec.origin;
  const [width, height] = spec.size;
  const [x, y, w, h] = spec.target;
  if (spec.rotation === 0) return [(x - originX) / width, (originY + height - y - h) / height, w / width, h / height];
  if (spec.rotation === 90) return [(y - originY) / height, (x - originX) / width, h / height, w / width];
  if (spec.rotation === 180) return [(originX + width - x - w) / width, (y - originY) / height, w / width, h / height];
  return [(originY + height - y - h) / height, (originX + width - x - w) / width, h / height, w / width];
}

for (const id of ['pdf-crop', 'pdf-redact'] as const) {
  for (const scenario of ['wide', 'narrow', 'resize', 'origins-rotations-mixed'] as const) {
    it(`${id} preserves authored PDF targets at ${scenario}`, async () => {
      const file = fixtures.find(candidate => candidate.filename === (scenario === 'origins-rotations-mixed' ? 'origins-rotations-mixed.pdf' : 'landmark.pdf'));
      if (!file) throw new Error('Named original fixture missing.');
      const input = await readFile(fileURLToPath(new URL(`./fixtures/pdf-coordinate/${file.filename}`, import.meta.url)));
      expect(input.length).toBe(file.bytes); expect(sha(input)).toBe(file.sha256);
      const page = await browser.newPage({ viewport: { width: scenario === 'narrow' ? 320 : 1200, height: 900 } });
      const external: string[] = [];
      const observations: unknown[] = [];
      let output: Uint8Array | null = null;
      const moduleFile = id === 'pdf-crop' ? 'PdfCropRunner.svelte' : 'PdfRedactRunner.svelte';
      const currentSource = await readFile(fileURLToPath(new URL(`../src/components/runners/${moduleFile}`, import.meta.url)));
      expect(sha(await readFile(join(distDir, '../src/components/runners', moduleFile)))).toBe(sha(currentSource));
      await page.route('**/*', async route => {
        if (new URL(route.request().url()).origin !== server.url) { external.push(route.request().url()); await route.abort(); }
        else await route.continue();
      });
      try {
        await page.goto(`${server.url}/tools/${id}/`);
        const choosing = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Drop file or click to browse', exact: true }).click();
        await (await choosing).setFiles({ name: file.filename, mimeType: 'application/pdf', buffer: input });
        await expect.poll(() => page.locator('canvas.pdf-canvas').evaluateAll(canvases => {
          const canvas = canvases[0] as HTMLCanvasElement | undefined;
          return canvas?.width ?? 0;
        })).toBe(720);
        await expect.poll(() => page.getByRole('button', { name: 'Cancel PDF loading', exact: true }).count()).toBe(0);
        if (id === 'pdf-crop' && file.pages.length > 1) await page.getByRole('checkbox', { name: /Apply to all pages/ }).uncheck();
        if (scenario === 'resize') await page.setViewportSize({ width: 320, height: 900 });
        const tolerances: number[] = [];
        for (const [index, spec] of file.pages.entries()) {
          if (index > 0) await page.getByRole('button', { name: 'Next page', exact: true }).click();
          await expect.poll(() => page.getByRole('button', { name: 'Cancel PDF loading', exact: true }).count()).toBe(0);
          const apply = page.getByRole('button', { name: id === 'pdf-crop' ? 'Crop PDF' : /Apply \d+ redaction/ });
          const overlay = page.locator('.draw-overlay');
          await overlay.scrollIntoViewIfNeeded();
          await expect.poll(() => page.getByRole('button', { name: 'Previous page', exact: true }).isDisabled()).toBe(index === 0);
          const box = await overlay.boundingBox();
          if (!box) throw new Error('Actual drawing overlay missing.');
          const canvasBox = await page.locator('canvas.pdf-canvas').boundingBox();
          if (!canvasBox) throw new Error('Actual displayed PDF canvas missing.');
          const [left, top, width, height] = visibleRectangle(spec);
          const intrinsic = await page.locator('canvas.pdf-canvas').evaluate(canvas => ({ width: (canvas as HTMLCanvasElement).width, height: (canvas as HTMLCanvasElement).height }));
          observations.push({ index, spec, box, canvasBox, intrinsic, visibleRectangle: [left, top, width, height] });
          const rotated = spec.rotation === 90 || spec.rotation === 270;
          tolerances.push(Math.max((rotated ? spec.size[1] : spec.size[0]) / canvasBox.width, (rotated ? spec.size[0] : spec.size[1]) / canvasBox.height) * 2);
          const start = { x: canvasBox.x + left * canvasBox.width, y: canvasBox.y + top * canvasBox.height };
          const end = { x: canvasBox.x + (left + width) * canvasBox.width, y: canvasBox.y + (top + height) * canvasBox.height };
          expect(start.x).toBeGreaterThanOrEqual(box.x);
          expect(start.y).toBeGreaterThanOrEqual(box.y);
          expect(end.x).toBeLessThanOrEqual(box.x + box.width);
          expect(end.y).toBeLessThanOrEqual(box.y + box.height);
          await page.mouse.move(start.x, start.y);
          await page.mouse.down();
          await page.mouse.move(end.x, end.y, { steps: 4 });
          await page.mouse.up();
          await expect.poll(() => apply.isDisabled()).toBe(false);
        }
        await page.getByRole('button', { name: id === 'pdf-crop' ? 'Crop PDF' : /Apply \d+ redaction/ }).click();
        const downloading = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const downloaded = await downloading;
        const path = await downloaded.path();
        if (!path) throw new Error('Real PDF artifact unavailable.');
        output = new Uint8Array(await readFile(path));
        const pdfTask = getDocument({ data: output.slice(), useSystemFonts: false });
        try {
          const pdf = await pdfTask.promise;
          expect(pdf.numPages).toBe(file.pages.length);
          for (const [index, spec] of file.pages.entries()) {
            const decoded = await pdf.getPage(index + 1);
            const [x, y, w, h] = spec.target;
            if (id === 'pdf-crop') {
              const expected = [x, y, x + w, y + h];
              observations.push({ page: index + 1, actualView: decoded.view, expected });
              for (const [part, wanted] of expected.entries()) expect(Math.abs((decoded.view[part] ?? NaN) - wanted)).toBeLessThanOrEqual(tolerances[index] ?? 0);
            } else {
              const viewport = decoded.getViewport({ scale: 1 });
              const { canvas, context } = decoderCanvasFactory(pdf.canvasFactory).create(Math.ceil(viewport.width), Math.ceil(viewport.height));
              await decoded.render({ canvas, canvasContext: context, viewport }).promise;
              const center = viewport.convertToViewportPoint(x + w / 2, y + h / 2);
              const [originX, originY] = spec.origin;
              const outside = viewport.convertToViewportPoint(originX + spec.size[0] - 37.5, originY + spec.size[1] - 35);
              const color = (point: unknown) => {
                if (!Array.isArray(point) || point.length !== 2) throw new Error('Independent PDF decoder returned invalid point coordinates.');
                const x: unknown = point[0], y: unknown = point[1];
                if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) throw new Error('Independent PDF decoder returned nonfinite point coordinates.');
                return Array.from(context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data);
              };
              const targetColor = color(center), outsideColor = color(outside);
              observations.push({ page: index + 1, actualView: decoded.view, targetColor, outsideColor });
              const png = canvas.toDataURL('image/png');
              if (!png.startsWith('data:image/png;base64,')) throw new Error('Independent PDF decoder produced no PNG.');
              await writeFile(join(evidenceDir, `${id}-${scenario}-page-${index + 1}.png`), Buffer.from(png.slice('data:image/png;base64,'.length), 'base64'), { flag: 'wx' });
              expect(targetColor).toEqual([0, 0, 0, 255]);
              expect(outsideColor).toEqual([0, 0, 255, 255]);
              expect(decoded.view).toEqual([originX, originY, originX + spec.size[0], originY + spec.size[1]]);
            }
          }
        } finally { await pdfTask.destroy(); }
        expect(external).toEqual([]);
      } finally {
        if (output) await writeFile(join(evidenceDir, `${id}-${scenario}-output.pdf`), output, { flag: 'wx' });
        await writeFile(join(evidenceDir, `${id}-${scenario}-observations.json`), JSON.stringify({ distDir, fixture: file, sourceSha256: sha(currentSource), external, observations, outputSha256: output ? sha(output) : null }, null, 2) + '\n', { flag: 'wx' });
        console.warn(JSON.stringify({ id, scenario, evidenceDir }));
        await page.close();
      }
    }, 30000);
  }
}

// Additive settled PLAN2 controls. The original eight cases above are retained
// byte-for-byte; all new calculations below use an independent PDFJS decoder.
import type { Page } from 'playwright';
type PointBox = [number, number, number, number];
type AdditiveSpec = { mediaBox: PointBox; cropBox: PointBox; rotation: number; target: PointBox | null };
type AdditiveFixture = { filename: string; bytes: number; sha256: string; pages: AdditiveSpec[] };
type PixelBox = { x: number; y: number; width: number; height: number };

async function additiveInput(filename: string): Promise<{ bytes: Buffer; specs: AdditiveSpec[] }> {
  const raw: unknown = JSON.parse(await readFile(fileURLToPath(new URL('./fixtures/pdf-coordinate/additive-provenance.json', import.meta.url)), 'utf8'));
  if (typeof raw !== 'object' || raw === null || !('outputs' in raw) || !Array.isArray(raw.outputs)) throw new Error('Additive original provenance unavailable.');
  const added = (raw.outputs as AdditiveFixture[]).find(item => item.filename === filename);
  const old = fixtures.find(item => item.filename === filename);
  const source = added ?? old;
  if (!source) throw new Error('Named additive or original fixture missing.');
  const bytes = await readFile(fileURLToPath(new URL(`./fixtures/pdf-coordinate/${filename}`, import.meta.url)));
  expect(bytes.length).toBe(source.bytes); expect(sha(bytes)).toBe(source.sha256);
  const specs = added?.pages ?? old?.pages.map(spec => ({ mediaBox: [spec.origin[0], spec.origin[1], spec.origin[0] + spec.size[0], spec.origin[1] + spec.size[1]] as PointBox,
    cropBox: [spec.origin[0], spec.origin[1], spec.origin[0] + spec.size[0], spec.origin[1] + spec.size[1]] as PointBox, rotation: spec.rotation, target: spec.target }));
  if (!specs) throw new Error('Independent original page records missing.');
  return { bytes, specs };
}

async function loaded(page: Page) {
  await expect.poll(() => page.locator('canvas.pdf-canvas').count(), { timeout: 3000 }).toBe(1);
  await expect.poll(() => page.getByRole('button', { name: 'Cancel PDF loading', exact: true }).count(), { timeout: 3000 }).toBe(0);
}
async function selectOriginal(page: Page, filename: string, bytes: Buffer) {
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Drop file or click to browse', exact: true }).click();
  await (await choosing).setFiles({ name: filename, mimeType: 'application/pdf', buffer: bytes });
  await loaded(page);
}
async function additiveCase(id: 'pdf-crop' | 'pdf-redact', label: string, filename: string,
  body: (page: Page, input: { bytes: Buffer; specs: AdditiveSpec[] }, observations: unknown[]) => Promise<void>, init?: (page: Page) => Promise<void>) {
  const input = await additiveInput(filename);
  const page = await browser.newPage({ viewport: { width: 1200, height: 1800 } });
  const external: string[] = [], errors: string[] = [], observations: unknown[] = [];
  const moduleFile = id === 'pdf-crop' ? 'PdfCropRunner.svelte' : 'PdfRedactRunner.svelte';
  const source = await readFile(fileURLToPath(new URL(`../src/components/runners/${moduleFile}`, import.meta.url)));
  expect(sha(await readFile(join(distDir, '../src/components/runners', moduleFile)))).toBe(sha(source));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => { if (new URL(route.request().url()).origin !== server.url) { external.push(route.request().url()); await route.abort(); } else await route.continue(); });
  try {
    if (init) await init(page);
    await page.goto(`${server.url}/tools/${id}/`);
    await selectOriginal(page, filename, input.bytes);
    await body(page, input, observations);
    expect(external).toEqual([]); expect(errors).toEqual([]);
  } finally {
    await writeFile(join(evidenceDir, `additive-${id}-${label}.json`), JSON.stringify({ id, label, distDir, input: { filename, bytes: input.bytes.length, sha256: sha(input.bytes), specs: input.specs }, sourceSha256: sha(source), observations, external, errors }, null, 2) + '\n', { flag: 'wx' });
    console.warn(JSON.stringify({ additive: label, id, evidenceDir }));
    await page.close();
  }
}

async function targetPixels(page: Page, bytes: Buffer, number: number, target: PointBox): Promise<PixelBox> {
  await page.locator('.draw-overlay').scrollIntoViewIfNeeded();
  const canvasBox = await page.locator('canvas.pdf-canvas').boundingBox();
  if (!canvasBox) throw new Error('Real displayed canvas missing.');
  const bitmap = await page.locator('canvas.pdf-canvas').evaluate(element => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }));
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  try {
    const pdf = await task.promise, original = await pdf.getPage(number);
    const base = original.getViewport({ scale: 1 });
    const viewport = original.getViewport({ scale: bitmap.width / base.width });
    const [x, y, w, h] = target;
    const first: unknown = viewport.convertToViewportPoint(x, y);
    const last: unknown = viewport.convertToViewportPoint(x + w, y + h);
    if (!Array.isArray(first) || !Array.isArray(last) || first.length !== 2 || last.length !== 2) throw new Error('Independent viewport returned invalid rectangle.');
    const x1: unknown = first[0], y1: unknown = first[1], x2: unknown = last[0], y2: unknown = last[1];
    if (typeof x1 !== 'number' || !Number.isFinite(x1) || typeof y1 !== 'number' || !Number.isFinite(y1) || typeof x2 !== 'number' || !Number.isFinite(x2) || typeof y2 !== 'number' || !Number.isFinite(y2)) throw new Error('Independent viewport returned nonfinite rectangle.');
    return { x: canvasBox.x + Math.min(x1, x2) / bitmap.width * canvasBox.width,
      y: canvasBox.y + Math.min(y1, y2) / bitmap.height * canvasBox.height,
      width: Math.abs(x2 - x1) / bitmap.width * canvasBox.width, height: Math.abs(y2 - y1) / bitmap.height * canvasBox.height };
  } finally { await task.destroy(); }
}
async function dragTarget(page: Page, bytes: Buffer, number: number, target: PointBox, finish = true) {
  const rectangle = await targetPixels(page, bytes, number, target);
  const overlay = await page.locator('.draw-overlay').boundingBox();
  if (!overlay) throw new Error('Actual drawing overlay missing.');
  expect(rectangle.x).toBeGreaterThanOrEqual(overlay.x); expect(rectangle.y).toBeGreaterThanOrEqual(overlay.y);
  expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(overlay.x + overlay.width);
  expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(overlay.y + overlay.height);
  await page.mouse.move(rectangle.x, rectangle.y); await page.mouse.down();
  await page.mouse.move(rectangle.x + rectangle.width, rectangle.y + rectangle.height, { steps: 4 });
  if (finish) await page.mouse.up();
  return rectangle;
}
async function alignedOverlay(page: Page, bytes: Buffer, number: number, target: PointBox, observations: unknown[]) {
  const expected = await targetPixels(page, bytes, number, target);
  const actual = await page.locator('.rect-existing').boundingBox();
  observations.push({ expectedOverlay: expected, actualOverlay: actual });
  expect(actual).not.toBeNull();
  if (!actual) throw new Error('Retained selection overlay missing.');
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(actual[key] - expected[key])).toBeLessThanOrEqual(1);
}
async function next(page: Page, direction: 'Next page' | 'Previous page') {
  await page.getByRole('button', { name: direction, exact: true }).click(); await loaded(page);
}
async function downloadedPdf(page: Page, id: 'pdf-crop' | 'pdf-redact', label: string): Promise<Uint8Array> {
  await page.getByRole('button', { name: id === 'pdf-crop' ? 'Crop PDF' : /Apply \d+ redaction/ }).click();
  return committedPdf(page, id, label);
}
async function committedPdf(page: Page, id: 'pdf-crop' | 'pdf-redact', label: string): Promise<Uint8Array> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await pending, path = await download.path();
  if (!path) throw new Error('Actual PDF output missing.');
  const bytes = new Uint8Array(await readFile(path));
  await writeFile(join(evidenceDir, `additive-${id}-${label}.pdf`), bytes, { flag: 'wx' });
  return bytes;
}
async function checkOutput(bytes: Uint8Array, views: PointBox[], black: { page: number; target: PointBox }[], observations: unknown[]) {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false });
  try {
    const pdf = await task.promise; expect(pdf.numPages).toBe(views.length);
    for (const [index, expected] of views.entries()) {
      const decoded = await pdf.getPage(index + 1); observations.push({ page: index + 1, expectedView: expected, actualView: decoded.view, outputSha256: sha(bytes) });
      for (const [part, wanted] of expected.entries()) expect(Math.abs((decoded.view[part] ?? NaN) - wanted)).toBeLessThanOrEqual(0.1);
      const selected = black.find(item => item.page === index + 1);
      if (selected) {
        const viewport = decoded.getViewport({ scale: 1 });
        const { canvas, context } = decoderCanvasFactory(pdf.canvasFactory).create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await decoded.render({ canvas, canvasContext: context, viewport }).promise;
        const [x, y, w, h] = selected.target;
        const point: unknown = viewport.convertToViewportPoint(x + w / 2, y + h / 2);
        if (!Array.isArray(point) || point.length !== 2 || typeof point[0] !== 'number' || typeof point[1] !== 'number') throw new Error('Independent sample coordinates missing.');
        const color = Array.from(context.getImageData(Math.floor(point[0]), Math.floor(point[1]), 1, 1).data);
        observations.push({ page: index + 1, targetColor: color }); expect(color).toEqual([0, 0, 0, 255]);
      }
    }
  } finally { await task.destroy(); }
}

for (const id of ['pdf-crop', 'pdf-redact'] as const) {
  it(`additive ${id}: draw then resize retains one-pixel overlay and output`, async () => additiveCase(id, 'draw-then-resize', 'landmark.pdf', async (page, input, observations) => {
    await dragTarget(page, input.bytes, 1, [40, 50, 80, 60]);
    await page.setViewportSize({ width: 320, height: 900 });
    await alignedOverlay(page, input.bytes, 1, [40, 50, 80, 60], observations);
    const output = await downloadedPdf(page, id, 'draw-then-resize');
    await checkOutput(output, id === 'pdf-crop' ? [[40, 50, 120, 110]] : [[0, 0, 400, 300]], id === 'pdf-redact' ? [{ page: 1, target: [40, 50, 80, 60] }] : [], observations);
  }), 30000);

  it(`additive ${id}: page2 forward and back retains selection and decoded output`, async () => additiveCase(id, 'page-navigation', 'origins-rotations-mixed.pdf', async (page, input, observations) => {
    if (id === 'pdf-crop') await page.getByRole('checkbox', { name: /Apply to all pages/ }).uncheck();
    await next(page, 'Next page'); await dragTarget(page, input.bytes, 2, [60, 80, 80, 60]);
    await next(page, 'Next page'); await next(page, 'Previous page');
    expect(await page.locator('.rect-existing').count()).toBe(1);
    await alignedOverlay(page, input.bytes, 2, [60, 80, 80, 60], observations);
    const views = input.specs.map(spec => spec.cropBox); if (id === 'pdf-crop') views[1] = [60, 80, 140, 140];
    await checkOutput(await downloadedPdf(page, id, 'page-navigation'), views, id === 'pdf-redact' ? [{ page: 2, target: [60, 80, 80, 60] }] : [], observations);
  }), 30000);

  for (const cancellation of ['pointercancel', 'lostpointercapture'] as const) {
    it(`additive ${id}: ${cancellation} discards an aborted gesture`, async () => additiveCase(id, cancellation, 'landmark.pdf', async (page, input, observations) => {
      await dragTarget(page, input.bytes, 1, [40, 50, 80, 60], false);
      const pointerId = await page.locator('.draw-overlay').evaluate(element => { for (let id = 1; id <= 10; id++) if (element.hasPointerCapture(id)) return id; throw new Error('Actual owned pointer capture missing.'); });
      if (cancellation === 'pointercancel') await page.locator('.draw-overlay').dispatchEvent('pointercancel', { pointerId, bubbles: true });
      else await page.locator('.draw-overlay').evaluate((element, id) => element.releasePointerCapture(id), pointerId);
      await page.mouse.up();
      await expect.poll(() => page.locator('.rect-existing').count(), { timeout: 2000 }).toBe(0);
      expect(await page.locator('.rect-live').count()).toBe(0);
      expect(await page.getByRole('button', { name: id === 'pdf-crop' ? 'Crop PDF' : /Apply \d+ redaction/ }).isDisabled()).toBe(true);
      expect(await page.locator('.draw-overlay').evaluate(element => getComputedStyle(element).touchAction)).toBe('none');
      await dragTarget(page, input.bytes, 1, [40, 50, 80, 60]);
      await checkOutput(await downloadedPdf(page, id, cancellation), id === 'pdf-crop' ? [[40, 50, 120, 110]] : [[0, 0, 400, 300]], id === 'pdf-redact' ? [{ page: 1, target: [40, 50, 80, 60] }] : [], observations);
    }), 30000);
  }

  for (const transition of ['page', 'render', 'file'] as const) {
    it(`additive ${id}: ${transition} change rejects a stale gesture`, async () => additiveCase(id, `stale-${transition}`, 'origins-rotations-mixed.pdf', async (page, input, observations) => {
      await dragTarget(page, input.bytes, 1, [40, 50, 80, 60], false);
      const button = page.getByRole('button', { name: transition === 'page' ? 'Next page' : transition === 'render' ? 'Retry original' : 'Dismiss original', exact: true });
      await button.focus(); await page.keyboard.press('Enter');
      if (transition === 'file') {
        const replacement = await additiveInput('landmark.pdf');
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Drop file or click to browse', exact: true }).focus(); await page.keyboard.press('Enter');
        await (await chooser).setFiles({ name: 'different-original.pdf', mimeType: 'application/pdf', buffer: replacement.bytes });
      }
      await loaded(page); await page.mouse.up();
      expect(await page.locator('.rect-existing').count()).toBe(0); expect(await page.locator('.rect-live').count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Download', exact: true }).count()).toBe(0);
      observations.push({ staleTransition: transition, existingRectangles: await page.locator('.rect-existing').count() });
    }), 30000);
  }

  it(`additive ${id}: valid empty page completes a blank bitmap`, async () => additiveCase(id, 'empty-page', 'empty-page.pdf', async (page, _input, observations) => {
    const bitmap = await page.locator('canvas.pdf-canvas').evaluate(element => {
      const canvas = element as HTMLCanvasElement, context = canvas.getContext('2d');
      if (!context) throw new Error('Actual blank page context missing.');
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return { width: canvas.width, height: canvas.height, allWhite: pixels.every((value, index) => index % 4 === 3 || value === 255) };
    });
    observations.push(bitmap); expect(bitmap.width).toBeGreaterThan(0); expect(bitmap.height).toBeGreaterThan(0); expect(bitmap.allWhite).toBe(true);
    expect(await page.locator('.rect-existing').count()).toBe(0); expect(await page.getByRole('button', { name: 'Download', exact: true }).count()).toBe(0);
    expect(await page.getByRole('alert').count()).toBe(0);
  }), 30000);

  it(`additive ${id}: fractional bitmap diagnostic preserves its decoded target`, async () => additiveCase(id, 'fractional-bitmap', 'fractional-bitmap.pdf', async (page, input, observations) => {
    observations.push(await page.locator('canvas.pdf-canvas').evaluate(element => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height })));
    await dragTarget(page, input.bytes, 1, [40, 50, 80, 60]);
    await alignedOverlay(page, input.bytes, 1, [40, 50, 80, 60], observations);
    const output = await downloadedPdf(page, id, 'fractional-bitmap');
    const task = getDocument({ data: output.slice(), useSystemFonts: false });
    try { const pdf = await task.promise, decoded = await pdf.getPage(1); observations.push({ actualView: decoded.view, diagnosticOnly: true });
      if (id === 'pdf-crop') for (const [index, wanted] of [40, 50, 120, 110].entries()) expect(Math.abs((decoded.view[index] ?? NaN) - wanted)).toBeLessThanOrEqual(2);
      else expect(decoded.view).toEqual([0, 0, 612, 792]);
    } finally { await task.destroy(); }
  }), 30000);
}

it('additive crop: default first-page box intersects all original visible views', async () => additiveCase('pdf-crop', 'uniform-page1', 'apply-to-all-partial.pdf', async (page, input, observations) => {
  expect(await page.getByRole('checkbox', { name: /Apply to all pages/ }).isChecked()).toBe(true);
  await dragTarget(page, input.bytes, 1, [40, 50, 80, 60]);
  await checkOutput(await downloadedPdf(page, 'pdf-crop', 'uniform-page1'), [[40, 50, 120, 110], [100, 80, 120, 110], [100, 80, 120, 110]], [], observations);
}), 30000);
it('additive crop: first inserted page2 selection remains the default source', async () => additiveCase('pdf-crop', 'uniform-page2', 'apply-to-all-partial.pdf', async (page, input, observations) => {
  await next(page, 'Next page'); await dragTarget(page, input.bytes, 2, [110, 85, 80, 60]);
  await next(page, 'Previous page'); await dragTarget(page, input.bytes, 1, [40, 50, 80, 60]);
  expect(await page.locator('.hint').isVisible()).toBe(true);
  expect(await page.locator('.hint').innerText()).toContain('Using the box drawn on page 2');
  expect(await page.getByRole('checkbox', { name: /Apply to all pages/ }).isChecked()).toBe(true);
  await checkOutput(await downloadedPdf(page, 'pdf-crop', 'uniform-page2'), [[110, 85, 190, 145], [110, 85, 190, 145], [110, 85, 190, 145]], [], observations);
}), 30000);
it('additive crop: empty uniform intersection refuses and preserves per-page recovery', async () => additiveCase('pdf-crop', 'uniform-empty', 'apply-to-all-empty.pdf', async (page, input, observations) => {
  await dragTarget(page, input.bytes, 1, [40, 50, 80, 60]); await page.getByRole('button', { name: 'Crop PDF', exact: true }).click();
  const message = 'The crop box does not intersect page 2. Draw a different box or turn off Apply to all pages.';
  await expect.poll(async () => page.getByRole('alert').allTextContents(), { timeout: 3000 }).toEqual([message]);
  expect(await page.locator('.rect-existing').count()).toBe(1); expect(await page.getByRole('button', { name: 'Download', exact: true }).count()).toBe(0);
  expect(await page.getByRole('checkbox', { name: /Apply to all pages/ }).isChecked()).toBe(true);
  await page.getByRole('checkbox', { name: /Apply to all pages/ }).uncheck();
  await checkOutput(await downloadedPdf(page, 'pdf-crop', 'uniform-empty'), [[40, 50, 120, 110], [600, 600, 800, 700]], [], observations);
}), 30000);

it('additive crop: pending original-page validation disables duplicate activation', async () => additiveCase('pdf-crop', 'uniform-pending', 'apply-to-all-partial.pdf', async (page, input, observations) => {
  await dragTarget(page, input.bytes, 1, [40, 50, 80, 60]);
  await page.evaluate(() => { (window as unknown as { pdfValidationProbe: { hold: boolean } }).pdfValidationProbe.hold = true; });
  await page.getByRole('button', { name: 'Crop PDF', exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { pdfValidationProbe: { pending: number } }).pdfValidationProbe.pending > 0, null, { timeout: 3000 });
  const run = page.getByRole('button', { name: 'Cropping...', exact: true });
  expect(await run.isDisabled()).toBe(true); await run.evaluate(element => (element as HTMLButtonElement).click());
  await page.evaluate(() => { (window as unknown as { pdfValidationProbe: { release(): void } }).pdfValidationProbe.release(); });
  await checkOutput(await committedPdf(page, 'pdf-crop', 'uniform-pending'), [[40, 50, 120, 110], [100, 80, 120, 110], [100, 80, 120, 110]], [], observations);
  const outputs = await page.evaluate(() => (window as unknown as { pdfValidationProbe: { outputs: number } }).pdfValidationProbe.outputs);
  observations.push({ committedPdfObjectUrls: outputs }); expect(outputs).toBe(1);
}, async page => { await page.addInitScript(() => {
  const post: unknown = Object.getOwnPropertyDescriptor(Worker.prototype, 'postMessage')?.value;
  const makeUrl: unknown = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')?.value;
  if (typeof post !== 'function' || typeof makeUrl !== 'function') throw new Error('Native observational APIs unavailable.');
  const queue: (() => void)[] = [];
  const probe = { hold: false, pending: 0, outputs: 0, release() { this.hold = false; for (const send of queue.splice(0)) send(); this.pending = 0; } };
  (window as unknown as { pdfValidationProbe: typeof probe }).pdfValidationProbe = probe;
  Worker.prototype.postMessage = function (this: Worker, message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
    const send = () => { Reflect.apply(post, this, [message, transfer]); };
    if (probe.hold && typeof message === 'object' && message !== null && 'action' in message && message.action === 'GetPage') { queue.push(send); probe.pending++; }
    else send();
  };
  URL.createObjectURL = function (value: Blob | MediaSource) {
    if (value instanceof Blob && value.type === 'application/pdf') probe.outputs++;
    const result: unknown = Reflect.apply(makeUrl, URL, [value]);
    if (typeof result !== 'string') throw new Error('Native object URL invalid.'); return result;
  };
  setTimeout(() => probe.release(), 10000);
}); }), 30000);
