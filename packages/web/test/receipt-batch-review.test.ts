import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/ReceiptBatchReviewHarness.svelte'); }, 30000);
afterAll(async () => { await harness?.close(); });

it('edits reviewed fields locally and exports a revalidated formula-safe CSV', async () => {
  const page = await harness.browser.newPage();
  const requests: string[] = [];
  page.on('request', request => { if (!request.url().startsWith(harness.url) || request.method() !== 'GET') requests.push(request.url()); });
  try {
    await page.goto(harness.url);
    await page.getByLabel('Receipt 1 merchant').fill('＝1+1');
    await page.getByLabel('Receipt 1 total').fill('=2+2');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    expect(await page.getByRole('alert').textContent()).toContain('Invalid decimal');
    await page.getByLabel('Receipt 1 total').fill('-3.25');
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    const download = await event;
    const path = await download.path();
    if (!path) throw new Error('No CSV download');
    const csv = await readFile(path, 'utf8');
    expect(csv).toContain('"\'＝1+1"');
    expect(csv).toContain(',-3.25,');
    expect(await page.getByText('Model-reported evidence (unverified)').count()).toBe(1);
    expect(requests).toEqual([]);
  } finally { await page.close(); }
}, 30000);
