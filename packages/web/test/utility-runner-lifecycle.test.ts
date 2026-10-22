import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';

describe('mounted utility lifecycle and downloads', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/UtilityHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });

  it('keeps download URLs live at click and revokes them on replacement and destruction', async () => {
    const page = await harness.browser.newPage({ viewport: { width: 375, height: 812 } });
    try {
      await page.addInitScript(() => {
        const state = { urls: new Set<string>(), liveAtClick: false };
        Object.assign(window, { utilityUrlState: state });
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (blob) => {
          const url = create(blob);
          state.urls.add(url);
          return url;
        };
        URL.revokeObjectURL = (url) => {
          state.urls.delete(url);
          revoke(url);
        };
        const originalClick: unknown = Reflect.get(HTMLAnchorElement.prototype, 'click');
        if (typeof originalClick !== 'function')
          throw new Error('Expected the native anchor click method.');
        const click = (anchor: HTMLAnchorElement) => {
          Reflect.apply(originalClick, anchor, []);
        };
        HTMLAnchorElement.prototype.click = function () {
          state.liveAtClick = state.urls.has(this.href);
          click(this);
        };
      });
      await page.goto(harness.url);
      await page.getByLabel('Amount', { exact: true }).fill('0');
      const calculate = page.getByRole('button', { name: 'Calculate', exact: true });
      await calculate.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON' }).click();
      const download = await downloaded;
      const path = await download.path();
      if (!path) throw new Error('Expected reopened browser download.');
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      expect(parsed).toMatchObject({ amount: 0, enabled: true });
      expect(
        await page.evaluate(() => {
          const state = (
            window as unknown as { utilityUrlState: { urls: Set<string>; liveAtClick: boolean } }
          ).utilityUrlState;
          return { count: state.urls.size, liveAtClick: state.liveAtClick };
        }),
      ).toEqual({ count: 1, liveAtClick: true });
      await page.getByLabel('Amount', { exact: true }).fill('1');
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { utilityUrlState: { urls: Set<string> } }).utilityUrlState.urls
              .size,
        ),
      ).toBe(0);
      await calculate.click();
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      const second = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON' }).click();
      await second;
      await page.getByRole('button', { name: 'Unmount calculator' }).click();
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { utilityUrlState: { urls: Set<string> } }).utilityUrlState.urls
              .size,
        ),
      ).toBe(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    } finally {
      await page.close();
    }
  }, 30000);

  it('aborts on destruction without a late rejection or leftover controls', async () => {
    const page = await harness.browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(harness.url);
      await page.getByLabel('Amount', { exact: true }).fill('1');
      await page.getByLabel('Result mode').selectOption('2');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.waitForFunction(
        () => typeof (window as unknown as { rejectOldRun?: unknown }).rejectOldRun === 'function',
      );
      await page.getByRole('button', { name: 'Unmount calculator' }).click();
      await page.evaluate(() => (window as unknown as { rejectOldRun: () => void }).rejectOldRun());
      expect(await page.getByLabel('Amount', { exact: true }).count()).toBe(0);
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30000);
});
