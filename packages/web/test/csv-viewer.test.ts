import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseCsv } from '../../core/src/utilities/csv-data';
import { openBrowserHarness } from './browserHarness';

describe('mounted CSV viewer editing and exports', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/CsvHarness.svelte'); }, 30000);
  afterAll(async () => { await harness?.close(); });

  it('searches beyond the rendered page and exports the actual filtered dataset', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await page.getByLabel('Input delimiter', { exact: true }).selectOption('comma');
      await page.getByLabel('Paste CSV').fill('name,count\n' + Array.from({ length: 110 }, (_, i) => `row${i},${i}`).join('\n'));
      await page.getByRole('button', { name: 'Load CSV', exact: true }).click();
      await page.getByRole('button', { name: 'Download CSV', exact: true }).waitFor();
      expect(await page.getByRole('button', { name: 'Edit source row 107 c0', exact: true }).count()).toBe(0);
      await page.getByLabel('Search all rows').fill('row105');
      expect(await page.getByRole('button', { name: 'Edit source row 107 c0', exact: true }).textContent()).toBe('row105');
      await page.getByLabel('Export rows').selectOption('current');
      const received = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
      const download = await received;
      const path = await download.path();
      if (!path) throw new Error('CSV download missing.');
      const bytes = await readFile(path);
      expect(parseCsv(bytes, { delimiter: 'comma', hasHeader: true }).rows.map(row => row.cells)).toEqual([['row105', '105']]);
      await page.getByLabel('Export rows').selectOption('all');
      const full = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
      const fullPath = await (await full).path();
      if (!fullPath) throw new Error('Full CSV download missing.');
      expect(parseCsv(await readFile(fullPath), { delimiter: 'comma', hasHeader: true }).rows).toHaveLength(110);
    } finally { await page.close(); }
  }, 30000);

  it('uses numeric sorting, keyboard cell commit and literal hostile text on mobile', async () => {
    const page = await harness.browser.newPage({ viewport: { width: 375, height: 812 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(harness.url);
      await page.getByLabel('Input delimiter', { exact: true }).selectOption('comma');
      await page.getByLabel('Paste CSV').fill('name,count\nTen,10\nTwo,2\nBlank,\nInvalid,not-a-number');
      await page.getByRole('button', { name: 'Load CSV', exact: true }).click();
      await page.getByRole('button', { name: 'Download CSV', exact: true }).waitFor();
      await page.getByLabel('Sort column', { exact: true }).selectOption('c1');
      await page.getByLabel('Numeric sort (invalid values last)').check();
      expect(await page.locator('tbody tr').first().textContent()).toContain('Two');
      await page.getByRole('button', { name: 'Edit source row 3 c0', exact: true }).focus();
      await page.keyboard.press('Enter');
      const input = page.getByRole('textbox', { name: 'Edit source row 3 c0', exact: true });
      await input.fill('<img src=x onerror=alert(1)>');
      await input.press('Control+Enter');
      expect(await page.getByRole('button', { name: 'Edit source row 3 c0', exact: true }).textContent()).toBe('<img src=x onerror=alert(1)>');
      expect(await page.locator('tbody img').count()).toBe(0);
      await page.getByLabel('Sort direction', { exact: true }).selectOption('desc');
      expect(await page.locator('tbody tr').first().textContent()).toContain('Ten');
      expect(await page.locator('tbody tr').last().textContent()).toContain('Invalid');
      const received = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
      const path = await (await received).path();
      if (!path) throw new Error('Edited CSV download missing.');
      const reopened = parseCsv(await readFile(path), { delimiter: 'comma', hasHeader: true });
      expect(reopened.rows[1].cells).toEqual(['<img src=x onerror=alert(1)>', '2']);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }, 30000);

  it('shows malformed input and preserves a legitimate empty CSV export', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await page.getByLabel('Input delimiter', { exact: true }).selectOption('comma');
      await page.getByLabel('Paste CSV').fill('a,b\n"unfinished');
      await page.getByRole('button', { name: 'Load CSV', exact: true }).click();
      await page.getByRole('alert').waitFor();
      expect(await page.getByRole('button', { name: 'Download CSV', exact: true }).count()).toBe(0);
      await page.getByLabel('Paste CSV').fill('');
      await page.getByRole('button', { name: 'Load CSV', exact: true }).click();
      await page.getByText('Empty data. You can download the empty CSV.').waitFor();
      const received = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download CSV', exact: true }).click();
      const path = await (await received).path();
      if (!path) throw new Error('Empty CSV download missing.');
      expect((await readFile(path)).byteLength).toBe(0);
    } finally { await page.close(); }
  }, 30000);

  it('invalidates a pending parse and ignores its stale failure after input change or unmount', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url + '?pending');
      await page.getByLabel('Input delimiter', { exact: true }).selectOption('comma');
      await page.getByLabel('Paste CSV').fill('a,b\n1,2');
      await page.getByRole('button', { name: 'Load CSV', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
      await page.waitForFunction(() => typeof (window as unknown as { rejectCsv?: unknown }).rejectCsv === 'function');
      await page.getByLabel('Paste CSV').fill('a,b\n3,4');
      await page.evaluate(() => (window as unknown as { rejectCsv: () => void }).rejectCsv());
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Download CSV', exact: true }).count()).toBe(0);
      await page.getByRole('button', { name: 'Load CSV', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Unmount CSV viewer', exact: true }).click();
      await page.evaluate(() => (window as unknown as { resolveCsv: () => void }).resolveCsv());
      expect(await page.getByRole('button', { name: 'Download CSV', exact: true }).count()).toBe(0);
      expect(await page.getByRole('alert').count()).toBe(0);
    } finally { await page.close(); }
  }, 30000);
});
