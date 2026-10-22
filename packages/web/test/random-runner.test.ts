import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';

describe('mounted random controls and bounded local history', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/PlanningHarness.svelte'); }, 30000);
  afterAll(async () => { await harness?.close(); });
  it('applies a real dice preset, records exports and clears history', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?id=dice-roller`); await page.getByRole('button', { name: 'd20', exact: true }).click(); expect(await page.getByLabel('Sides', { exact: true }).inputValue()).toBe('20'); await page.getByRole('button', { name: 'Roll dice' }).click(); await page.getByRole('heading', { name: 'History — 1 sets' }).waitFor(); const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export history CSV' }).click(); const path = await (await event).path(); if (!path) throw new Error('No CSV.'); const raw = await readFile(path, 'utf8'); expect(raw.split('\r\n')).toHaveLength(3); await page.getByRole('button', { name: 'Clear history' }).click(); expect(await page.getByRole('heading', { name: 'History — 0 sets' }).count()).toBe(1);
    } finally { await page.close(); }
  }, 30000);
  it('shows explicit empty coin ratio and actual flips after generation', async () => {
    const page = await harness.browser.newPage(); try { await page.goto(`${harness.url}?id=coin-flip`); expect(await page.getByText('Historical head ratio: No flips yet', { exact: true }).count()).toBe(1); await page.getByRole('button', { name: 'Flip coins' }).click(); await page.getByRole('heading', { name: 'History — 1 sets' }).waitFor(); expect(await page.getByText('Historical head ratio: No flips yet', { exact: true }).count()).toBe(0); } finally { await page.close(); }
  }, 30000);
  it('drops whole oldest sets when real coin history reaches the value budget', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?id=coin-flip`); await page.getByLabel('Flip count', { exact: true }).fill('1000');
      for (let i = 1; i <= 11; i++) { await page.getByRole('button', { name: 'Flip coins' }).click(); await page.getByRole('heading', { name: `History — ${Math.min(i, 10)} sets`, exact: true }).waitFor(); }
      const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export history CSV' }).click(); const path = await (await event).path(); if (!path) throw new Error('No CSV.');
      const rows = (await readFile(path, 'utf8')).split('\r\n'); expect(rows).toHaveLength(10001); expect(rows[1]).toMatch(/^"1","1","(Heads|Tails)"$/); expect(rows.at(-1)).toMatch(/^"10","1000","(Heads|Tails)"$/);
    } finally { await page.close(); }
  }, 30000);
});
