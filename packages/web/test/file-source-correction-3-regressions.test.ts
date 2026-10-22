import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

describe('FILE3 actual CSV metadata and mounted DropZone admission', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/File3DropZoneHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });
  it.each([
    ['blank.csv', ''],
    ['blank.tsv', ''],
    ['excel.csv', 'application/vnd.ms-excel'],
    ['UPPER.CSV', ''],
    ['UPPER.TSV', ''],
    ['normal.csv', 'text/csv'],
  ])('admits real %s/type %s and strictly parses the actual cells', async (name, type) => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      const zone = page.getByRole('button', { name: 'Select CSV sample', exact: true });
      await zone.waitFor();
      const transfer = await page.evaluateHandle(
        ({ name, type }) => {
          const data = new DataTransfer();
          data.items.add(new File(['a,b\n1,2\n3,4\n'], name, { type }));
          return data;
        },
        { name, type },
      );
      await zone.dispatchEvent('drop', { dataTransfer: transfer });
      expect(await page.getByLabel('Selected CSV files').textContent()).toBe(name);
      await expect
        .poll(() => page.getByLabel('Parsed CSV cells').textContent())
        .toBe('[["1","2"],["3","4"]]');
      expect(await page.getByLabel('CSV parser error').textContent()).toBe('');
    } finally {
      await page.close();
    }
  });
  it('admits a CSV suffix then rejects real invalid UTF8 content rather than claiming a table', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      const zone = page.getByRole('button', { name: 'Select CSV sample', exact: true });
      await zone.waitFor();
      const transfer = await page.evaluateHandle(() => {
        const data = new DataTransfer();
        data.items.add(new File([new Uint8Array([255, 254, 128])], 'spoof.csv', { type: '' }));
        return data;
      });
      await zone.dispatchEvent('drop', { dataTransfer: transfer });
      expect(await page.getByLabel('Selected CSV files').textContent()).toBe('spoof.csv');
      await expect
        .poll(() => page.getByLabel('CSV parser error').textContent())
        .toMatch(/UTF.?8|encoded|encoding/i);
      expect(await page.getByLabel('Parsed CSV cells').textContent()).toBe('');
    } finally {
      await page.close();
    }
  });
});
