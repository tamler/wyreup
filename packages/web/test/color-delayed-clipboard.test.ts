import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => {
  harness = await openBrowserHarness('./test/fixtures/ColorHarness.svelte');
}, 30000);
afterAll(async () => {
  await harness?.close();
});

it('a delayed color clipboard success does not publish after the source changes', async () => {
  const page = await harness.browser.newPage();
  page.setDefaultTimeout(5000);
  try {
    await page.goto(harness.url);
    await page.getByLabel('Color string').fill('#ff0000');
    await page.getByText('hsl(0, 100%, 50%)', { exact: true }).waitFor();
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () =>
            new Promise<void>((resolve) => {
              Object.assign(window, { resolveColorClipboard: resolve });
            }),
        },
      }),
    );
    await page.getByRole('button', { name: 'Copy' }).first().click();
    await page.getByLabel('Color string').fill('#0000ff');
    await page.getByText('hsl(240, 100%, 50%)', { exact: true }).waitFor();
    await page.evaluate(() =>
      (window as unknown as { resolveColorClipboard: () => void }).resolveColorClipboard(),
    );
    await page.waitForTimeout(30);
    expect(await page.getByRole('status').filter({ hasText: 'Copied' }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Copy HEX', exact: true }).textContent()).toBe(
      'Copy',
    );
  } finally {
    await page.close();
  }
}, 30000);
