import { afterAll, beforeAll, expect, it } from 'vitest';
import { openMediaCallerHarness } from './mediaCallerHarness';
let harness: Awaited<ReturnType<typeof openMediaCallerHarness>>;
beforeAll(async () => {
  harness = await openMediaCallerHarness('./test/fixtures/ChainSectionBeaconHarness.svelte');
}, 30000);
afterAll(async () => {
  await harness?.close();
});

it('retains the functional PRO destination while reporting no click beacon', async () => {
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
    const anchor = page.getByRole('link', { name: 'Try the stronger version →', exact: true });
    expect(await anchor.getAttribute('href')).toBe('/tools/bg-remove-pro');
    await anchor.click();
    expect(
      await page.evaluate(
        () => (window as unknown as { observedSeamBeacons: unknown[] }).observedSeamBeacons,
      ),
    ).toEqual([]);
    expect(await anchor.getAttribute('href')).toBe('/tools/bg-remove-pro');
  } finally {
    await page.close();
  }
}, 20000);
