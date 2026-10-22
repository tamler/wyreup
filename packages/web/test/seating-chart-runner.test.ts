import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';

describe('mounted actual seating editor and exports', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/PlanningHarness.svelte'); }, 30000);
  afterAll(async () => { await harness?.close(); });
  it('adds duplicate guests, enforces capacity atomically and saves/imports/prints literal text', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?id=wedding-seating-chart-builder`); await page.getByLabel('Guest names, one per line').fill('Alex\nAlex\n=HYPERLINK("x")'); await page.getByRole('button', { name: 'Import guest names' }).click(); await page.getByLabel('New table name').fill('<img src=x>'); await page.getByLabel('New table capacity').fill('1'); await page.getByRole('button', { name: 'Add table', exact: true }).click();
      const assigns = page.getByLabel(/^Assign Alex/); const tableValue = await assigns.nth(0).locator('option').nth(1).getAttribute('value'); if (!tableValue) throw new Error('Table missing.'); await assigns.nth(0).selectOption(tableValue); await assigns.nth(1).selectOption(tableValue); await page.getByRole('alert').waitFor(); expect(await assigns.nth(0).inputValue()).toBe(tableValue); expect(await assigns.nth(1).inputValue()).toBe(''); expect(await page.locator('img').count()).toBe(0);
      const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export seating CSV' }).click(); const path = await (await event).path(); if (!path) throw new Error('No CSV.'); expect(await readFile(path, 'utf8')).toContain("'=HYPERLINK");
      await page.getByLabel('Import plan JSON').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"kind":"seating","guests":[],"tables":[],"assignments":[{"guestId":"x","tableId":"x"}]}') }); expect(await page.getByLabel(/^Assign Alex/).count()).toBe(2);
      await page.evaluate(() => { window.print = () => { Object.assign(window, { printed: true }); }; }); await page.getByRole('button', { name: 'Print seating chart' }).click(); expect(await page.evaluate(() => (window as unknown as { printed: boolean }).printed)).toBe(true); expect(await page.getByRole('region', { name: 'Seating chart preview' }).textContent()).toContain('<img src=x>');
    } finally { await page.close(); }
  }, 30000);
});
