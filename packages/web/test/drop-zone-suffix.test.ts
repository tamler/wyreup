import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

describe('mounted DropZone suffix and MIME selection', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/DropZoneHarness.svelte');
  }, 30000);
  afterAll(async () => { await harness?.close(); });

  it('accepts empty-MIME uppercase suffixes and rejects a suffix followed by another extension', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      const zone = page.getByRole('button', { name: 'Select sample', exact: true });
      await zone.waitFor();
      const transfer = await page.evaluateHandle(() => {
        const data = new DataTransfer();
        data.items.add(new File(['synthetic selection data'], 'IMAGE.PSD', { type: '' }));
        return data;
      });
      await zone.dispatchEvent('drop', { dataTransfer: transfer });
      expect(await page.getByLabel('Selected files').textContent()).toBe('IMAGE.PSD');
      const wrong = await page.evaluateHandle(() => {
        const data = new DataTransfer();
        data.items.add(new File(['synthetic selection data'], 'IMAGE.PSD.txt', { type: '' }));
        return data;
      });
      await zone.dispatchEvent('drop', { dataTransfer: wrong });
      expect(await page.getByLabel('Selected files').textContent()).toBe('');
      await page.getByText('File type not accepted. Expected: .psd', { exact: true }).waitFor();
    } finally { await page.close(); }
  });

  it('case-folds the accept suffix with a vendor MIME through the existing global drop route', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url + '?mode=nef');
      await page.getByRole('button', { name: 'Select sample', exact: true }).waitFor();
      await page.evaluate(() => {
        const data = new DataTransfer();
        data.items.add(new File(['synthetic selection data'], 'sample.nef', { type: 'image/x-nikon-nef' }));
        document.dispatchEvent(new CustomEvent('wyreup:filedrop', { detail: { files: data.files } }));
      });
      expect(await page.getByLabel('Selected files').textContent()).toBe('sample.nef');
    } finally { await page.close(); }
  });

  it('preserves exact MIME, MIME wildcard and both universal wildcard rules', async () => {
    const page = await harness.browser.newPage();
    try {
      for (const [mode, type, expected] of [
        ['mime', 'image/jpeg', true], ['mime', 'image/png', false],
        ['wildcard', 'image/png', true], ['wildcard', '', false],
        ['all', '', true], ['star', '', true],
      ] as const) {
        await page.goto(harness.url + '?mode=' + mode);
        await page.getByRole('button', { name: 'Select sample', exact: true }).waitFor();
        const transfer = await page.evaluateHandle((type) => {
          const data = new DataTransfer();
          data.items.add(new File(['synthetic selection data'], 'sample.psd', { type }));
          return data;
        }, type);
        await page.getByRole('button', { name: 'Select sample', exact: true }).dispatchEvent('drop', { dataTransfer: transfer });
        expect(await page.getByLabel('Selected files').textContent()).toBe(expected ? 'sample.psd' : '');
      }
    } finally { await page.close(); }
  });

  it('opens the native chooser by keyboard and preserves its exact accept hint', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      const zone = page.getByRole('button', { name: 'Select sample', exact: true });
      await zone.focus();
      const chosen = page.waitForEvent('filechooser');
      await page.keyboard.press('Enter');
      const chooser = await chosen;
      expect(await chooser.element().getAttribute('accept')).toBe('.psd');
      await chooser.setFiles({ name: 'IMAGE.PSD', mimeType: '', buffer: Buffer.from('synthetic selection data') });
      expect(await page.getByLabel('Selected files').textContent()).toBe('IMAGE.PSD');
    } finally { await page.close(); }
  });
});
