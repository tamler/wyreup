import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { parseCsv } from '../../core/src/utilities/csv-data';
import { openBrowserHarness } from './browserHarness';

const fixture = (kind = 'known') =>
  fileURLToPath(
    new URL(`../../core/test/fixtures/catalog-files/bank-${kind}.pdf`, import.meta.url),
  );
async function upload(page: Page, kind = 'known') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Drop file or click to browse', exact: true }).click();
  await (await chooser).setFiles(fixture(kind));
}
async function load(page: Page, kind = 'known') {
  await page.getByLabel('Opening balance', { exact: true }).fill('1000.00');
  await page.getByLabel('Closing balance', { exact: true }).fill('912.66');
  await upload(page, kind);
  await page.getByRole('button', { name: 'Extract PDF text', exact: true }).click();
  await page.getByLabel('Role p1-l1', { exact: true }).waitFor();
}
async function approve(page: Page) {
  await page.getByLabel('Role p1-l1', { exact: true }).selectOption('opening');
  await page.getByLabel('Decision p1-l1', { exact: true }).selectOption('accept');
  await page.getByLabel('Decision p1-l2', { exact: true }).selectOption('accept');
  await page.getByLabel('Role p1-l3', { exact: true }).selectOption('non-financial');
  await page.getByLabel('Decision p1-l3', { exact: true }).selectOption('attach');
  await page.getByLabel('Attach p1-l3 to prior transaction', { exact: true }).selectOption('p1-l2');
  await page.getByLabel('Decision p1-l4', { exact: true }).selectOption('accept');
  await page.getByLabel('Decision p2-l1', { exact: true }).selectOption('accept');
  await page.getByLabel('Role p2-l2', { exact: true }).selectOption('closing');
  await page.getByLabel('Decision p2-l2', { exact: true }).selectOption('accept');
}
async function download(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reviewed CSV', exact: true }).click();
  const path = await (await event).path();
  if (!path) throw new Error('Reviewed CSV download missing');
  const table = parseCsv(await readFile(path), { delimiter: 'comma', hasHeader: true });
  return table.rows.map((r) =>
    Object.fromEntries(table.columns.map((c, i) => [c.label, r.cells[i]])),
  );
}
describe('mounted bank PDF review and reopened CSV', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/BankHarness.svelte', { fileWorker: true });
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });
  it('switches to unsigned debit-credit mapping and exports its actual PDF movements once', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await load(page, 'debit-credit');
      await page.getByLabel('Amount layout').selectOption('debit-credit');
      await page.getByLabel('Role p1-l1', { exact: true }).waitFor({ timeout: 3000 });
      expect(await page.getByRole('alert').count()).toBe(0);
      await approve(page);
      await page
        .getByLabel('I reviewed every candidate and visual-page exception', { exact: true })
        .check();
      const rows = await download(page);
      expect(
        rows
          .filter((row) => row.status === 'accepted' && row.role === 'transaction')
          .map((row) => [row.amount, row.debit, row.credit]),
      ).toEqual([
        ['-12.34', '12.34', ''],
        ['25.00', '', '25.00'],
        ['-100.00', '100.00', ''],
      ]);
    } finally {
      await page.close();
    }
  }, 30000);
  it('maps, explicitly reviews and corrects a transaction, then reopens exact reconciled raw CSV', async () => {
    const page = await harness.browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const unexpectedRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol === 'blob:' || url.protocol === 'data:') return;
      if (
        url.origin === new URL(harness.url).origin &&
        ['/', '/app.js', '/file-worker.js', '/bank-pdf-worker.js', '/favicon.ico'].includes(
          url.pathname,
        )
      )
        return;
      unexpectedRequests.push(url.origin + url.pathname);
    });
    try {
      await page.goto(harness.url);
      await load(page);
      expect(await page.getByRole('button', { name: 'Download reviewed CSV' }).isDisabled()).toBe(
        true,
      );
      await approve(page);
      await page.getByRole('button', { name: 'Edit p1-l2', exact: true }).click();
      await page.getByLabel('Edited amount', { exact: true }).fill('-12.30');
      await page.getByRole('button', { name: 'Save row edit', exact: true }).click();
      expect(await page.getByLabel('Decision p1-l2', { exact: true }).inputValue()).toBe('pending');
      await page.getByLabel('Decision p1-l2', { exact: true }).selectOption('accept');
      expect(await page.getByRole('status').first().textContent()).toContain(
        'reviewed-unreconciled',
      );
      expect(await page.getByRole('status').first().textContent()).toContain('0.04');
      await page.getByRole('button', { name: 'Edit p1-l2', exact: true }).click();
      await page.getByLabel('Edited amount', { exact: true }).fill('-12.34');
      await page.getByRole('button', { name: 'Save row edit', exact: true }).click();
      await page.getByLabel('Decision p1-l2', { exact: true }).selectOption('accept');
      await page.getByLabel('I reviewed every candidate and visual-page exception').check();
      const rows = await download(page);
      expect(rows).toHaveLength(6);
      expect(rows[1]).toMatchObject({
        amount: '-12.34',
        description: 'Card purchase continued note',
        sourcePage: '1',
        sourceLine: '2',
        overallStatus: 'reconciled',
        reconciliationDelta: '0.00',
      });
      expect(
        rows
          .filter((r) => r.status === 'accepted' && r.role === 'transaction')
          .reduce((sum, r) => sum + BigInt(r.amount.replace('.', '')), 0n),
      ).toBe(-8734n);
      expect(errors).toEqual([]);
      expect(unexpectedRequests).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30000);
  it('retains ignored money, supports keyboard edits and shows literal hostile description on mobile', async () => {
    const page = await harness.browser.newPage({ viewport: { width: 375, height: 812 } });
    try {
      await page.goto(harness.url);
      await load(page);
      await approve(page);
      await page.getByRole('button', { name: 'Edit p1-l2', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.getByLabel('Edited description').fill('<img src=x onerror=alert(1)>');
      await page.getByRole('button', { name: 'Save row edit', exact: true }).click();
      await page.getByLabel('Decision p1-l2', { exact: true }).selectOption('accept');
      await page
        .getByLabel('Reason p2-l1', { exact: true })
        .fill('Excluded after reviewing original movement');
      await page.getByLabel('Decision p2-l1', { exact: true }).selectOption('ignore');
      expect(await page.locator('tbody img').count()).toBe(0);
      await page.getByLabel('I reviewed every candidate and visual-page exception').check();
      const raw = await download(page);
      expect(raw.find((r) => r.sourcePage === '2' && r.sourceLine === '1')).toMatchObject({
        status: 'ignored',
        amount: '-100.00',
        overallStatus: 'reviewed-with-exceptions',
        reconciliationDelta: '100.00',
      });
      await page.getByLabel('Spreadsheet-safe text', { exact: true }).check();
      const safe = await download(page);
      expect(safe[1].amount).toBe("'-12.34");
      await page.screenshot({
        path: '/private/tmp/wyreup-catalog-evidence/bank-statement-mobile.png',
        fullPage: true,
      });
    } finally {
      await page.close();
    }
  }, 30000);
  it('makes a scanned page an explicit reasoned exception rather than omitting it', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await load(page, 'scan');
      await approve(page);
      expect(await page.getByRole('button', { name: 'Download reviewed CSV' }).isDisabled()).toBe(
        true,
      );
      await page
        .getByLabel('Page 3 review reason', { exact: true })
        .fill('Reviewed original scanned page; cannot convert its visual information');
      await page.getByLabel('Page 3 decision', { exact: true }).selectOption('ignore');
      await page.getByLabel('I reviewed every candidate and visual-page exception').check();
      const rows = await download(page);
      expect(rows.at(-1)).toMatchObject({
        sourcePage: '3',
        sourceLine: '',
        pageDecision: 'ignore',
        pageVisual: 'nontext',
        status: 'page-ignored',
        amount: '',
        overallStatus: 'reviewed-with-exceptions',
      });
    } finally {
      await page.close();
    }
  }, 30000);
  it('clears stale extraction success/rejection and releases owned download URLs on clear and unmount', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url + '?pending');
      await upload(page);
      await page.getByRole('button', { name: 'Extract PDF text', exact: true }).click();
      await page.waitForFunction(
        () => typeof (window as unknown as { rejectBank?: unknown }).rejectBank === 'function',
      );
      await page.getByRole('button', { name: 'Clear statement', exact: true }).click();
      await page.evaluate(() => (window as unknown as { rejectBank: () => void }).rejectBank());
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Download reviewed CSV' }).count()).toBe(0);
      await upload(page);
      await page.getByRole('button', { name: 'Extract PDF text', exact: true }).click();
      await page.waitForFunction(
        () => typeof (window as unknown as { resolveBank?: unknown }).resolveBank === 'function',
      );
      await page.getByRole('button', { name: 'Unmount bank converter', exact: true }).click();
      await page.evaluate(() => (window as unknown as { resolveBank: () => void }).resolveBank());
      expect(await page.getByRole('button', { name: 'Download reviewed CSV' }).count()).toBe(0);
      await page.goto(harness.url);
      await page.evaluate(() => {
        const original = URL.revokeObjectURL.bind(URL);
        const observed: string[] = [];
        (window as unknown as { bankRevoked: string[] }).bankRevoked = observed;
        URL.revokeObjectURL = (url) => {
          observed.push(url);
          original(url);
        };
      });
      await load(page);
      await approve(page);
      await page.getByLabel('I reviewed every candidate and visual-page exception').check();
      await download(page);
      await page.getByRole('button', { name: 'Unmount bank converter', exact: true }).click();
      expect(
        await page.evaluate(
          () => (window as unknown as { bankRevoked: string[] }).bankRevoked.length,
        ),
      ).toBe(1);
    } finally {
      await page.close();
    }
  }, 30000);
});
