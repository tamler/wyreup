import { afterAll, beforeAll, expect, it } from 'vitest';
import { openMediaCallerHarness } from './mediaCallerHarness';
let harness: Awaited<ReturnType<typeof openMediaCallerHarness>>;
beforeAll(async () => {
  harness = await openMediaCallerHarness('./test/fixtures/ChainSectionBeaconHarness.svelte');
}, 30000);
afterAll(async () => {
  await harness?.close();
});

it('continues to a local tool without a click beacon or a hosted upgrade link', async () => {
  const page = await harness.browser.newPage();
  page.setDefaultTimeout(3000);
  try {
    await page.addInitScript(() => {
      const observed: unknown[] = [];
      Object.assign(window, { observedSeamBeacons: observed });
      Object.defineProperty(navigator, 'sendBeacon', {
        configurable: true,
        value(url: unknown, data: unknown) {
          observed.push({ url, data });
          return true;
        },
      });
      document.addEventListener('click', (event) => event.preventDefault(), { capture: true });
    });
    await page.goto(harness.url);
    const continuation = page.getByRole('button', { name: 'convert-video media', exact: true });
    await continuation.waitFor();
    expect(await page.getByRole('link', { name: 'Try the stronger version →', exact: true }).count()).toBe(0);
    expect(await page.locator('a[href="/tools/bg-remove-pro"]').count()).toBe(0);

    // Let the actual handoff request finish while retaining the source document
    // so the same page's beacon recorder can observe the whole click.
    const destination = new URL('/tools/convert-video', harness.url).href;
    await page.route(destination, route => route.fulfill({ status: 204 }));
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url() === destination && response.request().isNavigationRequest()),
      continuation.click(),
    ]);
    expect(response.status()).toBe(204);
    expect(
      await page.evaluate(
        () => (window as unknown as { observedSeamBeacons: unknown[] }).observedSeamBeacons,
      ),
    ).toEqual([]);
  } finally {
    await page.close();
  }
}, 20000);
