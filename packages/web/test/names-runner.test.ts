import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';

describe('mounted names generation and selection', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/PlanningHarness.svelte'); }, 30000);
  afterAll(async () => { await harness?.close(); });
  it('renders hostile topics literally and copies/downloads generated selected names', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?id=podcast-name-generator`); await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (value: string) => { Object.assign(window, { copied: value }); return Promise.resolve(); } }, configurable: true }); }); await page.getByLabel('Optional topic').fill('<img src=x>'); await page.getByLabel('Number of ideas').fill('3'); await page.getByRole('button', { name: 'Generate names' }).click(); await page.getByRole('button', { name: 'Copy all names' }).waitFor(); expect(await page.locator('img').count()).toBe(0); await page.getByRole('button', { name: 'Copy all names' }).click(); expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toContain('<img src=x>'); const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download names' }).click(); const path = await (await event).path(); if (!path) throw new Error('No names.'); expect((await readFile(path, 'utf8')).split('\n')).toHaveLength(3);
    } finally { await page.close(); }
  }, 30000);
});
