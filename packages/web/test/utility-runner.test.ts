import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';

describe('mounted utility calculator', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/UtilityHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });

  it('blocks missing numbers and stale invalid JSON, preserves zero/false and typed choices', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      const calculate = page.getByRole('button', { name: 'Calculate', exact: true });
      await page.getByLabel('Amount', { exact: true }).waitFor();
      expect(await calculate.isDisabled()).toBe(true);
      await page.getByLabel('Amount', { exact: true }).fill('0');
      await page.getByLabel('Typed choice').selectOption('1');
      await calculate.click();
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      await page.getByLabel('Data', { exact: true }).fill('{broken');
      expect(await calculate.isDisabled()).toBe(true);
      expect(await page.getByRole('button', { name: 'Download JSON' }).count()).toBe(0);
      await page.getByLabel('Include data').uncheck();
      expect(await calculate.isEnabled()).toBe(true);
      await calculate.click();
      const downloadEvent = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON' }).click();
      const download = await downloadEvent;
      const json: unknown = JSON.parse(await readFile(await download.path(), 'utf8'));
      expect(json).toMatchObject({ amount: 0, enabled: false, choice: '1' });
    } finally {
      await page.close();
    }
  }, 30000);

  it('renders hostile string values literally in structured and raw fallback views', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await page.getByLabel('Amount', { exact: true }).fill('1');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      expect(
        await page
          .getByText('<img src=x onerror=alert(1)> </script> &', { exact: true })
          .textContent(),
      ).toBe('<img src=x onerror=alert(1)> </script> &');
      expect(await page.locator('img').count()).toBe(0);
      await page.getByLabel('Result mode').selectOption('1');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      const raw: unknown = JSON.parse((await page.locator('pre').textContent())!);
      expect((raw as { complex: { deep: { text: string } }[] }).complex[0].deep.text).toBe(
        '<img src=x onerror=alert(1)> </script> &',
      );
      expect(await page.locator('img').count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 30000);

  it('cancels immediately and ignores late rejection of an abandoned calculation', async () => {
    const page = await harness.browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(harness.url);
      await page.getByLabel('Amount', { exact: true }).fill('1');
      await page.getByLabel('Result mode').selectOption('2');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.evaluate(() => (window as unknown as { rejectOldRun: () => void }).rejectOldRun());
      await page.getByLabel('Result mode').selectOption('0');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30000);
});
