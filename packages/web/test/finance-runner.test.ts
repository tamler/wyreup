import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';
describe('mounted finance controls and complete artifacts', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/FinanceHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });
  it('offers labeled rate rows and CSV preview, cancels invalid drafts and ignores old rejections', async () => {
    const page = await harness.browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(harness.url);
      const calculate = page.getByRole('button', { name: 'Calculate', exact: true });
      expect(await calculate.isDisabled()).toBe(true);
      await page
        .getByRole('button', { name: 'Add Ordered discount rates row', exact: true })
        .click();
      await page.getByLabel('Discount (%) — your rate, row 1', { exact: true }).fill('20');
      await page
        .getByRole('button', { name: 'Add Ordered discount rates row', exact: true })
        .click();
      await page.getByLabel('Discount (%) — your rate, row 2', { exact: true }).fill('10');
      expect(await calculate.isEnabled()).toBe(true);
      await calculate.click();
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      expect(
        await page
          .getByText('Sale Price', { exact: true })
          .locator('..')
          .locator('dd')
          .textContent(),
      ).toBe('72');
      await page.getByRole('button', { name: 'Copy summary', exact: true }).click();
      expect(
        await page.evaluate(() => (window as unknown as { financeCopied: string }).financeCopied),
      ).toContain('Sale Price: 72');
      await page.getByRole('button', { name: 'Copy JSON' }).click();
      expect(
        await page.evaluate(
          () =>
            (
              JSON.parse((window as unknown as { financeCopied: string }).financeCopied) as {
                salePrice: number;
              }
            ).salePrice,
        ),
      ).toBe(72);
      await page.getByLabel('Harness execution').selectOption('deferred');
      await calculate.click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
      await page.waitForFunction(
        () =>
          typeof (window as unknown as { rejectFinanceRun?: unknown }).rejectFinanceRun ===
          'function',
      );
      await page.getByLabel('Paste Ordered discount rates as CSV or TSV').fill('percent\nbad');
      expect(await calculate.isDisabled()).toBe(true);
      expect(await page.getByRole('button', { name: 'Download JSON' }).count()).toBe(0);
      await page.evaluate(() =>
        (window as unknown as { rejectFinanceRun: () => void }).rejectFinanceRun(),
      );
      await page.getByLabel('Harness execution').selectOption('real');
      await page.getByLabel('Paste Ordered discount rates as CSV or TSV').fill('percent\n20\n10');
      await page
        .getByRole('button', { name: 'Preview pasted Ordered discount rates', exact: true })
        .click();
      expect(await calculate.isEnabled()).toBe(true);
      await calculate.click();
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      expect(await page.getByText('Old finance rejection', { exact: true }).count()).toBe(0);
      expect(
        await page.evaluate(() => (window as unknown as { financeAborts: number }).financeAborts),
      ).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 30000);
  it('paginates a real 1200-month schedule and copies/downloads every row with URL cleanup', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await page.getByLabel('Harness finance tool').selectOption('loan-calculator');
      await page.getByLabel('Loan principal', { exact: true }).fill('1200');
      await page.getByLabel('Annual percentage rate (%)', { exact: true }).fill('0');
      await page.getByLabel('Scheduled months', { exact: true }).fill('1200');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      const schedule = page.getByRole('region', { name: 'Schedule', exact: true });
      expect(await schedule.locator('tbody tr').count()).toBe(25);
      await schedule.getByRole('button', { name: 'Next Schedule page', exact: true }).click();
      expect(await schedule.locator('tbody tr').first().locator('td').first().textContent()).toBe(
        '26',
      );
      await page.getByRole('button', { name: 'Copy JSON' }).click();
      expect(
        await page.evaluate(
          () =>
            (
              JSON.parse((window as unknown as { financeCopied: string }).financeCopied) as {
                schedule: unknown[];
              }
            ).schedule.length,
        ),
      ).toBe(1200);
      const pendingDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON' }).click();
      const download = await pendingDownload;
      expect(download.suggestedFilename()).toBe('loan-calculator.json');
      const stream = await download.createReadStream();
      if (!stream) throw new Error('No actual download stream.');
      let text = '';
      for await (const chunk of stream) {
        const bytes: unknown = chunk;
        if (!Buffer.isBuffer(bytes)) throw new Error('Unexpected download chunk.');
        text += bytes.toString('utf8');
      }
      expect(
        (JSON.parse(text) as { schedule: Array<Record<string, unknown>> }).schedule.at(-1),
      ).toMatchObject({ month: 1200, balance: 0 });
      await page.getByRole('button', { name: 'Unmount finance calculator' }).click();
      expect(
        await page.evaluate(() => {
          const state = window as unknown as {
            financeCreatedUrls: string[];
            financeRevokedUrls: string[];
          };
          return state.financeCreatedUrls.every((url) => state.financeRevokedUrls.includes(url));
        }),
      ).toBe(true);
    } finally {
      await page.close();
    }
  }, 30000);
  it('renders hostile ingredient names as text and shows required source/currency scope', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await page.getByLabel('Harness finance tool').selectOption('recipe-cost-calculator');
      await page.getByLabel('Target food cost (%)', { exact: true }).fill('25');
      await page
        .getByLabel('Paste Recipe ingredients as CSV or TSV')
        .fill(
          'name,packageCost,packageQuantity,usedQuantity,unit\n<img src=x onerror=alert(1)>,10,1000,200,g',
        );
      await page
        .getByRole('button', { name: 'Preview pasted Recipe ingredients', exact: true })
        .click();
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Download JSON' }).waitFor();
      expect(await page.locator('img').count()).toBe(0);
      expect(
        await page.locator('td').filter({ hasText: '<img src=x onerror=alert(1)>' }).count(),
      ).toBeGreaterThan(0);
      expect(
        await page
          .getByLabel('Currency (one uppercase three-letter code)', { exact: true })
          .inputValue(),
      ).toBe('USD');
    } finally {
      await page.close();
    }
  }, 30000);
  it('requires only active rates, shows official definitions, and excludes inactive scalar fees', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await page.getByLabel('Calculation', { exact: true }).selectOption({ label: 'find-percent' });
      expect(
        await page.getByRole('button', { name: 'Add Ordered discount rates row' }).count(),
      ).toBe(0);
      await page.getByLabel('Sale price', { exact: true }).fill('75');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Copy JSON' }).click();
      expect(
        await page.evaluate(
          () =>
            (
              JSON.parse((window as unknown as { financeCopied: string }).financeCopied) as {
                discountPercent: number;
              }
            ).discountPercent,
        ),
      ).toBe(25);
      await page.getByLabel('Harness finance tool').selectOption('amazon-fba-profit-calculator');
      expect(await page.locator('a[href="https://sell.amazon.com/pricing"]').count()).toBe(1);
      const scalar = page.getByLabel('Referral rate, required (%)', { exact: true });
      expect(await scalar.inputValue()).toBe('');
      await page.getByLabel('Fulfillment fee per unit, required', { exact: true }).fill('0');
      await page.getByLabel('Use my entered fee bands', { exact: true }).check();
      expect(await scalar.count()).toBe(0);
      await page.getByRole('button', { name: 'Add Fee bands row', exact: true }).click();
      await page.getByLabel('Band rate (%) — your rate, row 1', { exact: true }).fill('15');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Copy JSON' }).click();
      expect(
        await page.evaluate(() => {
          const result = JSON.parse(
            (window as unknown as { financeCopied: string }).financeCopied,
          ) as { totalFees: number; inputs: Record<string, unknown> };
          return {
            fees: result.totalFees,
            hasScalar: Object.hasOwn(result.inputs, 'referralRate'),
          };
        }),
      ).toEqual({ fees: 15, hasScalar: false });
      await page.getByLabel('Use my entered fee bands', { exact: true }).uncheck();
      expect(await scalar.inputValue()).toBe('');
      expect(await page.getByRole('button', { name: 'Calculate', exact: true }).isDisabled()).toBe(
        true,
      );
      await scalar.fill('0');
      expect(await page.getByRole('button', { name: 'Calculate', exact: true }).isEnabled()).toBe(
        true,
      );
    } finally {
      await page.close();
    }
  }, 30000);
});
