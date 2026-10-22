import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';
describe('mounted actual building row calculators', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/BuildingHardwareHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });
  it.each([
    ['board-foot-calculator', 'totalBoardFeet', 16],
    ['gutter-size-calculator', 'selectedIndex', 1],
    ['generator-wattage-calculator', 'headroomPeakW', 750],
  ] as const)(
    'downloads the complete actual %s known answer',
    async (id, key, value) => {
      const page = await harness.browser.newPage();
      try {
        await page.goto(`${harness.url}?id=${id}`);
        await page.getByRole('button', { name: 'Calculate', exact: true }).click();
        await page.getByRole('button', { name: 'Download JSON' }).waitFor();
        const event = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download JSON' }).click();
        const path = await (await event).path();
        if (!path) throw new Error('Missing JSON download');
        expect((JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>)[key]).toBe(
          value,
        );
        await page.setViewportSize({ width: 375, height: 812 });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
      } finally {
        await page.close();
      }
    },
    30000,
  );
  it('rejects bad/blank/fractional rows before run and uses keyboard Add/Remove with explicit zero', async () => {
    const page = await harness.browser.newPage();
    page.setDefaultTimeout(5000);
    try {
      await page.goto(harness.url);
      await page.getByLabel('Quantity (whole pieces) 1').fill('1.5');
      expect(await page.getByRole('button', { name: 'Calculate', exact: true }).isDisabled()).toBe(
        true,
      );
      expect(await page.getByRole('alert').textContent()).toContain('$.pieces[0].quantity');
      expect(
        await page.evaluate(
          () => (window as unknown as { buildingProbe: { calls: number } }).buildingProbe.calls,
        ),
      ).toBe(0);
      await page.getByLabel('Quantity (whole pieces) 1').fill('');
      expect(await page.getByRole('button', { name: 'Calculate', exact: true }).isDisabled()).toBe(
        true,
      );
      await page.getByLabel('Quantity (whole pieces) 1').fill('0');
      await page.getByRole('button', { name: 'Add row', exact: true }).focus();
      await page.keyboard.press('Enter');
      expect(await page.getByLabel('Quantity (whole pieces) 2').count()).toBe(1);
      await page.getByRole('button', { name: 'Remove row 2' }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.waitForTimeout(30);
      expect(await page.getByRole('alert').allTextContents()).toEqual([]);
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON' }).click();
      const path = await (await event).path();
      if (!path) throw new Error('No zero-result download');
      expect(
        (JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>).totalBoardFeet,
      ).toBe(0);
    } finally {
      await page.close();
    }
  }, 30000);
  it('separates JSON syntax, semantic validation and parsed preview/apply from committed rows', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?id=generator-wattage-calculator`);
      await page.getByText('Paste a JSON row array', { exact: true }).click();
      const input = page.getByLabel('Paste loads');
      for (const value of [
        '{broken',
        '[{"name":"bad","runningW":100,"startingW":50,"quantity":1}]',
        '[{"name":"bad","runningW":100,"startingW":100,"quantity":"1"}]',
        '[{"name":"bad","runningW":100,"startingW":100,"quantity":1,"extra":2}]',
      ]) {
        await input.fill(value);
        expect(
          await page.getByRole('button', { name: 'Calculate', exact: true }).isDisabled(),
        ).toBe(true);
        expect(await page.getByRole('alert').count()).toBeGreaterThan(0);
      }
      await input.fill(
        '[{"name":"<img src=x onerror=alert(1)>","runningW":10,"startingW":20,"quantity":2}]',
      );
      expect(await page.getByLabel('Parsed row preview').count()).toBe(1);
      expect(await page.getByRole('button', { name: 'Calculate', exact: true }).isDisabled()).toBe(
        true,
      );
      await page.getByRole('button', { name: 'Apply rows' }).click();
      expect(await page.getByLabel('Load name 1').inputValue()).toContain('<img');
      expect(await page.locator('img').count()).toBe(0);
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      await page.getByLabel('Running watts 1', { exact: true }).fill('30');
      expect(await page.getByRole('button', { name: 'Download JSON' }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Calculate', exact: true }).isDisabled()).toBe(
        true,
      );
    } finally {
      await page.close();
    }
  }, 30000);
  it.each(['edit', 'cancel', 'unmount'] as const)(
    'invalidates deferred actual work on %s and ignores late rejection',
    async (action) => {
      const page = await harness.browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      try {
        await page.goto(`${harness.url}?defer=1`);
        await page.getByRole('button', { name: 'Calculate', exact: true }).click();
        await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
        if (action === 'edit') await page.getByLabel('Quantity (whole pieces) 1').fill('3');
        else
          await page
            .getByRole('button', {
              name: action === 'cancel' ? 'Cancel' : 'Unmount runner',
              exact: true,
            })
            .click();
        await page.evaluate(() =>
          (window as unknown as { buildingProbe: { reject(): void } }).buildingProbe.reject(),
        );
        await page.waitForTimeout(30);
        expect(await page.getByRole('button', { name: 'Download JSON' }).count()).toBe(0);
        expect(await page.getByRole('alert').count()).toBe(0);
        expect(errors).toEqual([]);
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { buildingProbe: { aborted: number } }).buildingProbe.aborted,
          ),
        ).toBe(1);
      } finally {
        await page.close();
      }
    },
    30000,
  );
  it('discards a pending paste, surfaces copy failure and revokes only owned download URLs', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.addInitScript(() => {
        const probe = { created: [] as string[], revoked: [] as string[] };
        Object.assign(window, { buildingUrls: probe });
        const create = URL.createObjectURL.bind(URL),
          revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (blob) => {
          const url = create(blob);
          probe.created.push(url);
          return url;
        };
        URL.revokeObjectURL = (url) => {
          probe.revoked.push(url);
          revoke(url);
        };
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error('Clipboard blocked')) },
        });
      });
      await page.goto(harness.url);
      await page.getByText('Paste a JSON row array', { exact: true }).click();
      await page.getByLabel('Paste pieces').fill('[]');
      expect(await page.getByRole('button', { name: 'Calculate', exact: true }).isDisabled()).toBe(
        true,
      );
      await page.getByRole('button', { name: 'Discard paste' }).click();
      expect(await page.getByLabel('Quantity (whole pieces) 1').inputValue()).toBe('2');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Copy JSON' }).click();
      await page.getByText('Copy unavailable. Use Download JSON.', { exact: true }).waitFor();
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON' }).click();
      await download;
      await page.getByLabel('Quantity (whole pieces) 1').fill('3');
      expect(
        await page.getByText('Copy unavailable. Use Download JSON.', { exact: true }).count(),
      ).toBe(0);
      expect(
        await page.evaluate(() => {
          const p = (
            window as unknown as { buildingUrls: { created: string[]; revoked: string[] } }
          ).buildingUrls;
          return p.revoked.length === 1 && p.revoked[0] === p.created[0];
        }),
      ).toBe(true);
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      const second = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON' }).click();
      await second;
      await page.getByRole('button', { name: 'Unmount runner' }).click();
      expect(
        await page.evaluate(() => {
          const p = (
            window as unknown as { buildingUrls: { created: string[]; revoked: string[] } }
          ).buildingUrls;
          return (
            p.created.length === 2 &&
            p.revoked.length === 2 &&
            p.created.every((url, index) => p.revoked[index] === url)
          );
        }),
      ).toBe(true);
    } finally {
      await page.close();
    }
  }, 30000);
});
