import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/TextPreloadOwnedHarness.svelte'); }, 30000);
afterAll(async () => { await harness?.close(); });

it('uses the same original BOM/CRLF File after numeric arrival and no-edit byte mode changes', async () => {
  const page = await harness.browser.newPage();
  page.setDefaultTimeout(5000);
  try {
    await page.goto(harness.url);
    await expect.poll(() => page.getByLabel('Input text').inputValue()).toBe('A\n');
    await page.getByLabel('Conversion', { exact: true }).selectOption({ label: 'UTF-8 bytes (plain text)' });
    await page.getByLabel('Byte format', { exact: true }).selectOption({ label: 'Hexadecimal pairs' });
    await page.getByRole('button', { name: /^Run / }).click();
    await page.getByRole('region', { name: 'Text result' }).waitFor();
    expect(await page.getByRole('region', { name: 'Text result' }).textContent()).toBe('ef bb bf 41 0d 0a');
    expect(await page.evaluate(() => (window as unknown as { ownedTextProbe: { calls: unknown[]; admissions: unknown[] } }).ownedTextProbe)).toEqual({
      calls: [{ sameFile: true, bytes: [239, 187, 191, 65, 13, 10] }],
      admissions: [{ status: 'admitted', sameFile: true }],
    });
  } finally { await page.close(); }
}, 30000);

it('refuses invalid original UTF-8 after numeric display instead of replacing its bytes', async () => {
  const page = await harness.browser.newPage();
  page.setDefaultTimeout(5000);
  try {
    await page.goto(harness.url + '?invalid=1');
    await expect.poll(() => page.getByLabel('Input text').inputValue()).toBe('\ufffda');
    await page.getByLabel('Conversion', { exact: true }).selectOption({ label: 'UTF-8 bytes (plain text)' });
    await page.getByLabel('Byte format', { exact: true }).selectOption({ label: 'Hexadecimal pairs' });
    await page.getByRole('button', { name: /^Run / }).click();
    await page.locator('.error-panel, .result-panel').waitFor();
    expect(await page.getByRole('alert').textContent()).toContain('valid UTF-8');
    expect(await page.evaluate(() => (window as unknown as { ownedTextProbe: { calls: unknown[]; admissions: unknown[] } }).ownedTextProbe)).toEqual({
      calls: [{ sameFile: true, bytes: [255, 97] }],
      admissions: [{ status: 'refused', sameFile: true }],
    });
  } finally { await page.close(); }
}, 30000);

it('keeps an edited result separate from the untouched original handover', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    await expect.poll(() => page.getByLabel('Input text').inputValue()).toBe('A\n');
    await page.getByLabel('Conversion', { exact: true }).selectOption({ label: 'UTF-8 bytes (plain text)' });
    await page.getByLabel('Byte format', { exact: true }).selectOption({ label: 'Hexadecimal pairs' });
    await page.getByLabel('Input text').fill('B');
    await page.getByRole('button', { name: /^Run / }).click();
    await page.getByRole('region', { name: 'Text result' }).waitFor();
    expect(await page.getByRole('region', { name: 'Text result' }).textContent()).toBe('42');
    expect(await page.evaluate(() => (window as unknown as { ownedTextProbe: { calls: unknown[]; admissions: unknown[] } }).ownedTextProbe)).toEqual({
      calls: [{ sameFile: false, bytes: [66] }], admissions: [],
    });
  } finally { await page.close(); }
}, 30000);
