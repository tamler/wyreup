import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

describe('utility form input notifications', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/UtilityHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });

  it('settles after mount and invalidates a pending run when only the JSON draft changes', async () => {
    const page = await harness.browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(harness.url);
      const calculate = page.getByRole('button', { name: 'Calculate', exact: true });
      await page.getByLabel('Amount', { exact: true }).fill('1');
      expect(await calculate.isEnabled()).toBe(true);
      await page.getByLabel('Result mode').selectOption('2');
      await calculate.click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
      await page.waitForFunction(
        () => typeof (window as unknown as { rejectOldRun?: unknown }).rejectOldRun === 'function',
      );

      await page.getByLabel('Data', { exact: true }).fill('{broken');
      expect(await calculate.isDisabled()).toBe(true);
      expect(await page.getByRole('button', { name: 'Cancel', exact: true }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Download JSON' }).count()).toBe(0);
      await page.evaluate(() => (window as unknown as { rejectOldRun: () => void }).rejectOldRun());
      await page.getByLabel('Result mode').selectOption('0');
      await page.getByLabel('Data', { exact: true }).fill('{"retained":2}');
      await calculate.click();
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30000);

  it('shows sanitizer failures before and after the invalid JSON field is hidden', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await page.getByLabel('Amount', { exact: true }).fill('1');
      await page.getByLabel('Data', { exact: true }).fill('{"nested":[1e309]}');
      const calculate = page.getByRole('button', { name: 'Calculate', exact: true });
      expect(await calculate.isDisabled()).toBe(true);
      expect(await page.getByText('$.data.nested[0]: Numbers must be finite.', { exact: true }).isVisible()).toBe(true);
      await page.getByLabel('Include data', { exact: true }).uncheck();
      expect(await page.getByRole('alert').textContent()).toContain('Numbers must be finite');
      expect(await calculate.isDisabled()).toBe(true);
      await page.getByLabel('Include data', { exact: true }).check();
      await page.getByLabel('Data', { exact: true }).fill('{"nested":[2]}');
      expect(await calculate.isEnabled()).toBe(true);
      expect(await page.getByRole('alert').count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 30000);
});
