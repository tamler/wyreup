import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/OriginalTextAdmissionHarness.svelte'); }, 30000);
afterAll(async () => { await harness?.close(); });

it('keeps the exact original bytes when switching from default numeric mode to UTF-8 without editing', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    await expect.poll(async () => page.getByLabel('Input text').inputValue()).toBe('16\n');
    expect(await page.evaluate(() => (window as unknown as { originalTextProbe: { admissions: unknown[] } }).originalTextProbe.admissions)).toEqual([]);
    await page.getByLabel('Conversion', { exact: true }).selectOption({ label: 'UTF-8 bytes (plain text)' });
    await page.getByLabel('Byte format', { exact: true }).selectOption({ label: 'Hexadecimal pairs' });
    await page.getByRole('button', { name: /^Run / }).click();
    await page.getByRole('button', { name: 'Download', exact: true }).waitFor();
    expect(await page.getByRole('region', { name: 'Text result' }).textContent()).toBe('ef bb bf 31 36 0d 0a');
    const probe = await page.evaluate(() => (window as unknown as { originalTextProbe: { originalCalls: boolean[]; admissions: { sameFile: boolean; status: string }[] } }).originalTextProbe);
    expect(probe.originalCalls).toEqual([true]);
    expect(probe.admissions).toEqual([{ sameFile: true, status: 'admitted' }]);
  } finally { await page.close(); }
}, 30000);
