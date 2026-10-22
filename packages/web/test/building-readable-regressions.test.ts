import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';
describe('building readable previews across singleton/full row limits', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/BuildingHardwareHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });
  it('renders a single actual board row and readable totals rather than raw-only output', async () => {
    const page = await harness.browser.newPage();
    page.setDefaultTimeout(3000);
    try {
      await page.goto(harness.url);
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      expect(await page.getByRole('table', { name: 'pieces table' }).count()).toBe(1);
      expect(await page.getByLabel('Result summary').count()).toBeGreaterThan(0);
      expect(await page.getByRole('table', { name: 'pieces table' }).getByRole('row').count()).toBe(
        2,
      );
    } finally {
      await page.close();
    }
  }, 30000);
  it('preserves all100 board rows in paginated readable tables and complete JSON artifact', async () => {
    const page = await harness.browser.newPage();
    page.setDefaultTimeout(3000);
    try {
      await page.goto(harness.url);
      await page.getByText('Paste a JSON row array', { exact: true }).click();
      await page.getByLabel('Paste pieces').fill(
        JSON.stringify(
          Array.from({ length: 100 }, () => ({
            thicknessIn: 1,
            widthIn: 12,
            lengthFt: 8,
            quantity: 1,
            pricePerBoardFoot: 3,
          })),
        ),
      );
      await page.getByRole('button', { name: 'Apply rows' }).click();
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      expect(await page.getByRole('table', { name: 'pieces table' }).count()).toBe(1);
      let count = 0;
      for (let pageIndex = 0; pageIndex < 4; pageIndex++) {
        count +=
          (await page.getByRole('table', { name: 'pieces table' }).getByRole('row').count()) - 1;
        if (pageIndex < 3) await page.getByRole('button', { name: 'Next pieces page' }).click();
      }
      expect(count).toBe(100);
      expect(await page.getByRole('button', { name: 'Next pieces page' }).isDisabled()).toBe(true);
      expect(await page.getByLabel('Result summary').count()).toBeGreaterThan(0);
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON' }).click();
      const path = await (await event).path();
      if (!path) throw new Error('No full JSON');
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
        totalBoardFeet: 800,
        totalCost: 2400,
      });
      expect(
        (JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>).pieces,
      ).toHaveLength(100);
    } finally {
      await page.close();
    }
  }, 30000);
  it('renders singleton construction material/labor line items and formatted totals', async () => {
    const page = await harness.browser.newPage();
    page.setDefaultTimeout(3000);
    try {
      await page.goto(`${harness.url}?id=construction-estimate-generator`);
      await page.getByText('Validated estimate preview', { exact: true }).waitFor();
      expect(await page.getByRole('table', { name: 'Materials table' }).count()).toBe(1);
      expect(await page.getByRole('table', { name: 'Labor table' }).count()).toBe(1);
      expect(await page.getByLabel('Result summary').count()).toBeGreaterThan(0);
      expect(await page.getByText('103.95', { exact: true }).count()).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 30000);
  it('paginates all100 material and100 labor items while preserving full estimate JSON', async () => {
    const page = await harness.browser.newPage();
    page.setDefaultTimeout(3000);
    try {
      await page.goto(`${harness.url}?id=construction-estimate-generator`);
      await page.getByText('Validated estimate preview', { exact: true }).waitFor();
      for (let i = 1; i < 100; i++) {
        await page.getByRole('button', { name: 'Add materials row' }).click();
        await page.getByRole('button', { name: 'Add labor row' }).click();
      }
      expect(await page.getByLabel('materials Description 100').count()).toBe(1);
      expect(await page.getByLabel('labor Description 100').count()).toBe(1);
      for (const section of ['Materials', 'Labor']) {
        expect(await page.getByRole('table', { name: `${section} table` }).count()).toBe(1);
        let count = 0;
        for (let i = 0; i < 4; i++) {
          count +=
            (await page
              .getByRole('table', { name: `${section} table` })
              .getByRole('row')
              .count()) - 1;
          if (i < 3) await page.getByRole('button', { name: `Next ${section} page` }).click();
        }
        expect(count).toBe(100);
        expect(await page.getByRole('button', { name: `Next ${section} page` }).isDisabled()).toBe(
          true,
        );
      }
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
      const path = await (await event).path();
      if (!path) throw new Error('No complete estimate');
      const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      expect(value.materials).toHaveLength(100);
      expect(value.labor).toHaveLength(100);
      expect(value.totalMinor).toBe(10395);
    } finally {
      await page.close();
    }
  }, 60000);
});
