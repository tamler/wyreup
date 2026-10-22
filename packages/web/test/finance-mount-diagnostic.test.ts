import { expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

it('mounts the actual finance component without runtime initialization errors', async () => {
  const harness = await openBrowserHarness('./test/fixtures/FinanceHarness.svelte');
  const page = await harness.browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(harness.url, { timeout: 5000 });
    expect(errors).toEqual([]);
    expect(
      await page.getByLabel('Currency (one uppercase three-letter code)', { exact: true }).count(),
    ).toBe(1);
  } finally {
    await page.close();
    await harness.close();
  }
}, 10000);
