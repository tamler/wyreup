import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';

describe('mounted parsed row calculator', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/PlanningHarness.svelte'); }, 30000);
  afterAll(async () => { await harness?.close(); });
  it('previews exact decimal grade weights, blocks invalid rows and calls the real module', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?id=grade-calculator`); await page.getByRole('table', { name: 'Parsed input preview' }).waitFor(); await page.getByLabel('Rows CSV or TSV').fill('name,grade,weight\n<img src=x>,80,33.33\nWork,90,33.33'); await page.getByLabel('Remaining weight (%)').fill('33.34'); expect(await page.locator('img').count()).toBe(0); const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Calculate', exact: true }).click(); await page.getByRole('button', { name: 'Download JSON' }).click(); const path = await (await event).path(); if (!path) throw new Error('No result.'); const result = JSON.parse(await readFile(path, 'utf8')) as { remainingWeightPercent: number }; expect(result.remainingWeightPercent).toBe(33.34);
      await page.getByLabel('Rows CSV or TSV').fill('name,grade,weight\nBad,80,33.333'); expect(await page.getByRole('button', { name: 'Calculate', exact: true }).isDisabled()).toBe(true); expect(await page.getByRole('button', { name: 'Download JSON' }).count()).toBe(0);
      await page.getByLabel('Import local CSV or TSV').setInputFiles({ name: 'grades.tsv', mimeType: 'text/tab-separated-values', buffer: Buffer.from('name\tgrade\tweight\nImported\t80\t66.66') }); await page.getByText('Imported', { exact: true }).waitFor();
    } finally { await page.close(); }
  }, 30000);
});
