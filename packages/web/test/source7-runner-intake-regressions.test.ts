import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { openSource7LifecycleHarness } from './source7LifecycleHarness';

// Real runner and DropZone components. The 64-byte serialized fixture limit
// tests prop/preview admission, not a replacement for catalogue/native limits.
let harness: Awaited<ReturnType<typeof openSource7LifecycleHarness>>;
beforeAll(async () => { harness = await openSource7LifecycleHarness(); }, 30000);
afterAll(async () => { await harness?.close(); });
type URLRow = { name: string | null; bytes: number; type: string };

async function pageCase(query: string, action: (page: Page) => Promise<void>) {
  const context = await harness.browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const external: string[] = [];
  try {
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === harness.url) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await page.addInitScript(() => {
      const native = URL.createObjectURL.bind(URL);
      const rows: Array<{ name: string | null; bytes: number; type: string }> = [];
      Object.assign(window, { source7PreviewURLs: rows });
      URL.createObjectURL = function (value) {
        if (value instanceof Blob) rows.push({ name: value instanceof File ? value.name : null, bytes: value.size, type: value.type });
        return native(value);
      };
    });
    await page.goto(harness.url + query);
    await page.locator('[data-source7-ready="true"]').waitFor();
    await action(page);
    expect(external).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { source7Probe: { runs: string[] } }).source7Probe.runs)).toEqual([]);
  } finally { await context.close(); }
}
async function previews(page: Page) {
  return page.evaluate(() => (window as unknown as { source7PreviewURLs: URLRow[] }).source7PreviewURLs);
}
async function drop(page: Page, name: string, type: string, bytes: number) {
  const data = await page.evaluateHandle(({ name, type, bytes }) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], name, { type })); return transfer;
  }, { name, type, bytes });
  try { await page.getByRole('region', { name: 'SOURCE7 runner', exact: true }).locator('.drop-zone').dispatchEvent('drop', { dataTransfer: data }); }
  finally { await data.dispose(); }
}

for (const [runner, filename, mime] of [
  ['bank', 'statement.pdf', 'application/pdf'],
  ['csv', 'table.csv', 'text/csv'],
  ['midi', 'pitch.mp3', 'audio/mpeg'],
  ['psd', 'image.psd', 'image/vnd.adobe.photoshop'],
  ['stl', 'part.stl', 'model/stl'],
] as const) {
  it(`${runner} forwards its exact serialized size bound to the real DropZone`, async () => {
    await pageCase('?scenario=intake&runner=' + runner, async page => {
      await drop(page, filename, mime, 64);
      expect(await page.locator('.drop-zone__filename').textContent()).toBe(filename);
      expect(await page.locator('.drop-zone__error-msg').count()).toBe(0);
      await drop(page, 'oversized-' + filename, mime, 65);
      await page.getByText('oversized-' + filename + ' is too large. Maximum: 64 bytes.', { exact: true }).waitFor();
      expect(await page.locator('.drop-zone__filename').count()).toBe(0);
      expect(await previews(page)).toEqual([]);
    });
  }, 20000);
}

for (const runner of ['image', 'trim'] as const) {
  for (const initial of [false, true]) {
    for (const kind of ['oversized', 'wrong-MIME'] as const) {
      it(`${runner} refuses ${initial ? 'initial' : 'changed'} ${kind} preload before any preview URL`, async () => {
        await pageCase('?scenario=preload&runner=' + runner, async page => {
          if (initial) await page.getByRole('button', { name: 'Unmount SOURCE7 target', exact: true }).click();
          await page.getByRole('button', { name: 'Deliver ' + kind + ' preload', exact: true }).click();
          if (initial) await page.getByRole('button', { name: 'Remount SOURCE7 target', exact: true }).click();
          // Rendering must settle through an actual visible refusal, not a
          // same-turn empty URL sample before the component's reactive work.
          await page.getByRole('region', { name: 'SOURCE7 runner', exact: true }).getByText(/too large|size limit|not accepted|unsupported|cannot import|not interpreted/i).first().waitFor();
          expect(await previews(page)).toEqual([]);
          expect(await page.locator('.thumb-card__img,video[src],audio[src]').count()).toBe(0);
          const admitted = await page.evaluate(() => (window as unknown as { source7Probe: { admissions(): Array<{ status: string }> } }).source7Probe.admissions());
          expect(admitted.some(row => row.status === 'admitted')).toBe(false);
        });
      }, 20000);
    }
  }
}

it('one valid boundary image preload remains staged while awaiting its required second image', async () => {
  await pageCase('?scenario=preload&runner=image', async page => {
    await page.getByRole('button', { name: 'Deliver boundary preload', exact: true }).click();
    await page.getByRole('img', { name: 'valid.png', exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Compare images', exact: true }).isDisabled()).toBe(true);
    expect((await previews(page)).filter(row => row.name === 'valid.png')).toEqual([{ name: 'valid.png', bytes: 64, type: 'image/png' }]);
  });
}, 20000);

for (const kind of ['oversized', 'wrong-mime'] as const) {
  it(`additional image picker rejects ${kind} before preview and preserves its valid original`, async () => {
    await pageCase('?scenario=preload&runner=image', async page => {
      await page.getByRole('button', { name: 'Deliver boundary preload', exact: true }).click();
      await page.getByRole('img', { name: 'valid.png', exact: true }).waitFor();
      const choosing = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Add more', exact: true }).click();
      await (await choosing).setFiles({ name: 'rejected.png', mimeType: kind === 'wrong-mime' ? 'text/plain' : 'image/png', buffer: Buffer.alloc(kind === 'oversized' ? 65 : 64) });
      await page.getByRole('region', { name: 'SOURCE7 runner', exact: true }).getByText(/too large|size limit|not accepted|unsupported|cannot import|not interpreted/i).first().waitFor();
      expect((await previews(page)).filter(row => row.name === 'rejected.png')).toEqual([]);
      expect(await page.getByRole('img', { name: 'rejected.png', exact: true }).count()).toBe(0);
      expect(await page.getByRole('img', { name: 'valid.png', exact: true }).isVisible()).toBe(true);
      expect(await page.getByRole('button', { name: 'Compare images', exact: true }).isDisabled()).toBe(true);
    });
  }, 20000);
}
