import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/CronPreloadOwnedHarness.svelte'); }, 30000);
afterAll(async () => { await harness?.close(); });

it('admits only explicit unchanged imported text after a real file-free cron operation', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    await page.getByRole('button', { name: 'Use original text', exact: true }).click();
    await expect.poll(() => page.getByLabel('description', { exact: true }).inputValue()).toBe('every weekday at 9am');
    expect(await page.evaluate(() => (window as unknown as { cronPreloadProbe: { admissions: unknown[] } }).cronPreloadProbe.admissions)).toEqual([]);
    await page.getByRole('button', { name: 'Calculate', exact: true }).click();
    await page.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { cronPreloadProbe: unknown }).cronPreloadProbe)).toEqual({
      reads: 1, calls: [{ inputCount: 0, description: 'every weekday at 9am' }],
      admissions: [{ sameFile: true, status: 'admitted' }],
    });
  } finally { await page.close(); }
}, 30000);

it('description edits leave the original unacknowledged', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    await page.getByRole('button', { name: 'Use original text', exact: true }).click();
    await expect.poll(() => page.getByLabel('description', { exact: true }).inputValue()).toBe('every weekday at 9am');
    await page.getByLabel('description', { exact: true }).fill('every day at 10am');
    await page.getByRole('button', { name: 'Calculate', exact: true }).click();
    await page.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { cronPreloadProbe: unknown }).cronPreloadProbe)).toEqual({
      reads: 1, calls: [{ inputCount: 0, description: 'every day at 10am' }], admissions: [],
    });
  } finally { await page.close(); }
}, 30000);

it('fields mode does not read or admit a stored text file', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    await page.getByLabel('Mode', { exact: true }).selectOption({ label: 'Five fields and next runs' });
    await page.getByRole('button', { name: 'Use original text', exact: true }).click();
    await page.getByText('Choose text mode to use this file. Fields mode does not import files.', { exact: true }).waitFor();
    expect(await page.evaluate(() => (window as unknown as { cronPreloadProbe: unknown }).cronPreloadProbe)).toEqual({ reads: 0, calls: [], admissions: [] });
    expect(await page.getByRole('button', { name: 'Download original', exact: true }).count()).toBe(1);
  } finally { await page.close(); }
}, 30000);
