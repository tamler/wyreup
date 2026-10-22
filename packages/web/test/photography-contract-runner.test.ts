import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';

describe('mounted editable photography draft', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/PlanningHarness.svelte'); }, 30000);
  afterAll(async () => { await harness?.close(); });
  it('generates, edits, downloads and prints text nodes without evaluating HTML', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?id=photography-contract-generator`); await page.getByLabel('Photographer', { exact: true }).fill('Photographer'); await page.getByLabel('Client', { exact: true }).fill('Client'); await page.getByLabel('Project', { exact: true }).fill('<img src=x> portraits'); await page.getByRole('button', { name: 'Generate draft' }).click(); await page.getByLabel('Editable agreement draft').waitFor(); const edited = '<img src=x> edited draft'; await page.getByLabel('Editable agreement draft').fill(edited); await page.getByRole('button', { name: 'Replace edited draft from particulars' }).waitFor(); expect(await page.locator('img').count()).toBe(0); const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download text' }).click(); const path = await (await event).path(); if (!path) throw new Error('No text.'); expect(await readFile(path, 'utf8')).toBe(edited);
      await page.evaluate(() => { window.print = () => { Object.assign(window, { printed: true }); }; }); await page.getByRole('button', { name: 'Print draft' }).click(); expect(await page.locator('.print-container pre').textContent()).toBe(edited); expect(await page.locator('.print-container img').count()).toBe(0); expect(await page.evaluate(() => (window as unknown as { printed: boolean }).printed)).toBe(true);
      await page.getByLabel('Session date', { exact: true }).fill('2026-02-29'); await page.getByRole('alert').waitFor(); expect(await page.getByLabel('Editable agreement draft').count()).toBe(0); expect(await page.getByRole('button', { name: 'Generate draft' }).isDisabled()).toBe(true);
      await page.getByLabel('Session date', { exact: true }).fill('2026-02-28'); await page.getByRole('button', { name: 'Generate draft' }).click(); await page.getByLabel('Editable agreement draft').waitFor();
      await page.getByLabel('Fee', { exact: true }).fill(''); expect(await page.getByLabel('Editable agreement draft').count()).toBe(0);
    } finally { await page.close(); }
  }, 30000);
});
