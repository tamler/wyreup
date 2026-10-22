import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { openBrowserHarness } from './browserHarness';

async function jsonDownload(page: Page): Promise<Record<string, unknown>> {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  const path = await (await event).path();
  if (!path) throw new Error('Missing calculator JSON download');
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}
describe('mounted existing date and compound extensions', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/DateCompoundHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });
  it('shows signed day/week/hour/calendar/business results, exact holidays, empty weekends and zero', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await page.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
      expect(await page.locator('[data-result=days]').textContent()).toBe('364');
      await page.getByLabel('Start date', { exact: true }).fill('2026-01-02');
      await page.getByLabel('End date', { exact: true }).fill('2026-01-06');
      await page.waitForFunction(
        () => document.querySelector('[data-result="business-days"]')?.textContent === '2',
      );
      expect(await jsonDownload(page)).toMatchObject({
        totalDays: 4,
        totalWeeks: 4 / 7,
        totalHours: 96,
        businessDays: 2,
        breakdown: { years: 0, months: 0, days: 4 },
      });
      await page
        .getByLabel('Holiday dates, one YYYY-MM-DD per line', { exact: true })
        .fill('2026-01-02\n2026-01-03');
      await page.waitForFunction(
        () => document.querySelector('[data-result="business-days"]')?.textContent === '1',
      );
      await page.getByLabel('Start date', { exact: true }).fill('2026-01-06');
      await page.getByLabel('End date', { exact: true }).fill('2026-01-02');
      await page.waitForFunction(
        () => document.querySelector('[data-result="days"]')?.textContent === '-4',
      );
      expect(await jsonDownload(page)).toMatchObject({
        totalDays: -4,
        totalHours: -96,
        businessDays: -1,
        breakdown: { years: 0, months: 0, days: -4 },
      });
      await page.getByLabel('Holiday dates, one YYYY-MM-DD per line', { exact: true }).fill('');
      await page.getByLabel('Saturday (6)', { exact: true }).uncheck();
      await page.getByLabel('Sunday (7)', { exact: true }).uncheck();
      await page.waitForFunction(
        () => document.querySelector('[data-result="business-days"]')?.textContent === '-4',
      );
      await page.getByLabel('End date', { exact: true }).fill('2026-01-06');
      await page.waitForFunction(
        () => document.querySelector('[data-result="days"]')?.textContent === '0',
      );
      expect(await jsonDownload(page)).toMatchObject({
        totalDays: 0,
        totalHours: 0,
        businessDays: 0,
      });
    } finally {
      await page.close();
    }
  });
  it('exposes month-end constrain/reject, preserves weekday semantics, and visibly fails invalid holidays', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await page.getByRole('button', { name: 'Add / Subtract', exact: true }).click();
      expect(await page.getByText('Weekend ISO weekdays', { exact: true }).count()).toBe(0);
      await page.getByLabel('Start date', { exact: true }).fill('2026-01-31');
      await page.locator('#add-amount').fill('1');
      await page.getByRole('button', { name: 'Months', exact: true }).click();
      await page.getByText('2026-02-28', { exact: true }).waitFor();
      await page.getByLabel('Month-end behavior', { exact: true }).selectOption('reject');
      await page.getByRole('alert').waitFor();
      expect(await page.getByRole('button', { name: 'Download JSON', exact: true }).count()).toBe(
        0,
      );
      await page.getByRole('button', { name: 'Day of week', exact: true }).click();
      await page.getByLabel('Date', { exact: true }).fill('2026-01-03');
      await page.getByText('Saturday', { exact: true }).waitFor();
      expect(await jsonDownload(page)).toMatchObject({ dayName: 'Saturday', dayIndex: 6 });
      await page.getByRole('button', { name: 'Difference', exact: true }).click();
      await page
        .getByLabel('Holiday dates, one YYYY-MM-DD per line', { exact: true })
        .fill('2026-02-30');
      await page.getByRole('alert').waitFor();
      expect(await page.getByRole('button', { name: 'Download JSON', exact: true }).count()).toBe(
        0,
      );
    } finally {
      await page.close();
    }
  });
  it('offers all six frequencies and beginning/end deposits with full nominal and real JSON', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?kind=compound`);
      await page.getByLabel('Principal', { exact: true }).fill('1000');
      await page.getByLabel('Annual nominal return (%)', { exact: true }).fill('10');
      await page.getByLabel('Years', { exact: true }).fill('1');
      await page.getByLabel('Annual inflation (%)', { exact: true }).fill('10');
      await page.getByLabel('Compounding frequency', { exact: true }).selectOption('1');
      await page.waitForFunction(() =>
        document.querySelector('[data-result="nominal"]')?.textContent?.includes('1,100'),
      );
      expect(await jsonDownload(page)).toMatchObject({
        finalBalance: 1100,
        realFinalBalance: 1000,
        yearlyBreakdown: [{ year: 1, realBalance: 1000 }],
      });
      expect(
        await page
          .getByLabel('Compounding frequency', { exact: true })
          .locator('option')
          .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
      ).toEqual(['1', '2', '4', '12', '52', '365']);
      await page.getByLabel('Principal', { exact: true }).fill('0');
      await page.getByLabel('Annual nominal return (%)', { exact: true }).fill('12');
      await page.getByLabel('Annual inflation (%)', { exact: true }).fill('0');
      await page.getByLabel('Monthly contribution', { exact: true }).fill('100');
      await page.getByLabel('Compounding frequency', { exact: true }).selectOption('12');
      await page.waitForFunction(() =>
        document.querySelector('[data-result="nominal"]')?.textContent?.includes('1,268'),
      );
      const end = await jsonDownload(page);
      expect(end.finalBalanceUnrounded).toBeCloseTo(1268.2503013196945, 9);
      await page
        .getByLabel('Monthly contribution timing', { exact: true })
        .selectOption('beginning');
      await page.waitForFunction(() =>
        document.querySelector('[data-result="nominal"]')?.textContent?.includes('1,281'),
      );
      const beginning = await jsonDownload(page);
      expect(beginning.finalBalanceUnrounded).toBeCloseTo(1280.9328043328915, 9);
      expect(beginning.inputs).toMatchObject({ contributionTiming: 'beginning', inflationRate: 0 });
      await page.getByRole('button', { name: /^Year-by-year breakdown/ }).click();
      expect(
        await page
          .getByRole('columnheader', { name: 'Inflation-adjusted balance', exact: true })
          .count(),
      ).toBe(1);
    } finally {
      await page.close();
    }
  });
  it('renders a zero projection without invalid SVG, rejects blanks, and reports clipboard denial', async () => {
    const page = await harness.browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(`${harness.url}?kind=compound`);
      await page.getByLabel('Principal', { exact: true }).fill('0');
      await page.getByLabel('Annual nominal return (%)', { exact: true }).fill('0');
      await page.getByLabel('Monthly contribution', { exact: true }).fill('0');
      await page.getByLabel('Years', { exact: true }).fill('2');
      await page.waitForFunction(
        () => document.querySelector('[data-result="nominal"]')?.textContent === '$0.00',
      );
      const projection = await jsonDownload(page);
      expect(projection).toMatchObject({ finalBalance: 0, realFinalBalance: 0, totalInterest: 0 });
      expect(
        await page
          .getByRole('img', { name: 'Compound interest growth chart' })
          .locator('path')
          .evaluateAll((paths) => paths.map((path) => path.getAttribute('d'))),
      ).not.toEqual(expect.arrayContaining([expect.stringMatching(/NaN|Infinity/)]));
      await page.evaluate(() => {
        (window as unknown as { extensionCopyFailure: boolean }).extensionCopyFailure = true;
      });
      await page.getByRole('button', { name: 'Copy JSON', exact: true }).click();
      await page.getByText('Clipboard denied', { exact: true }).waitFor();
      await page.getByLabel('Principal', { exact: true }).fill('');
      await page
        .getByText('Enter a finite number in every numeric field; blank fields are not zero.', {
          exact: true,
        })
        .waitFor();
      expect(await page.getByRole('button', { name: 'Download JSON', exact: true }).count()).toBe(
        0,
      );
    } finally {
      await page.close();
    }
  });
  it('does not present a finite raw projection with nonfinite rounded outputs as a valid zero balance', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?kind=compound`);
      await page.getByLabel('Principal', { exact: true }).fill('1000000000000');
      await page.getByLabel('Annual nominal return (%)', { exact: true }).fill('1000');
      await page.getByLabel('Years', { exact: true }).fill('69');
      await page.getByLabel('Compounding frequency', { exact: true }).selectOption('365');
      await page.waitForFunction(
        () => !!document.querySelector('[data-result="nominal"], [role="alert"]'),
      );
      if (await page.getByRole('button', { name: 'Download JSON', exact: true }).count()) {
        const value = await jsonDownload(page);
        for (const key of ['finalBalance', 'realFinalBalance', 'totalInterest']) {
          expect(typeof value[key]).toBe('number');
          expect(Number.isFinite(value[key])).toBe(true);
        }
        expect(value.finalBalanceUnrounded).toBeGreaterThan(1e307);
      } else {
        expect(await page.getByRole('alert').textContent()).toMatch(
          /finite|numeric|projection|result/i,
        );
      }
    } finally {
      await page.close();
    }
  });
  it.each(['date', 'compound'])(
    'cancels %s stale success/rejection and revokes owned URLs on change and unmount',
    async (kind) => {
      const page = await harness.browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.goto(`${harness.url}?kind=${kind}`);
        await page.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Copy JSON', exact: true }).click();
        await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
        expect(
          await page.evaluate(
            () =>
              (
                JSON.parse((window as unknown as { extensionCopied: string }).extensionCopied) as {
                  valid: boolean;
                }
              ).valid,
          ),
        ).toBe(true);
        await jsonDownload(page);
        await page.getByLabel('Harness execution', { exact: true }).selectOption('deferred');
        const field =
          kind === 'date'
            ? page.getByLabel('Start date', { exact: true })
            : page.getByLabel('Principal', { exact: true });
        await field.fill(kind === 'date' ? '2026-01-02' : '20');
        await page.waitForFunction(
          () =>
            typeof (window as unknown as { rejectExtension?: unknown }).rejectExtension ===
            'function',
        );
        await page.getByLabel('Harness execution', { exact: true }).selectOption('normal');
        await field.fill(kind === 'date' ? '2026-01-03' : '30');
        await page.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
        await page.evaluate(() =>
          (window as unknown as { rejectExtension: () => void }).rejectExtension(),
        );
        expect(await page.getByRole('alert').count()).toBe(0);
        await page.getByLabel('Harness execution', { exact: true }).selectOption('deferred');
        await field.fill(kind === 'date' ? '2026-01-04' : '40');
        await page.getByText('Calculating', { exact: true }).waitFor();
        await page.waitForFunction(
          () =>
            typeof (window as unknown as { finishExtension?: unknown }).finishExtension ===
            'function',
        );
        await page.getByRole('button', { name: 'Unmount extension', exact: true }).click();
        await page.evaluate(() =>
          (window as unknown as { finishExtension: () => void }).finishExtension(),
        );
        expect(await page.getByRole('button', { name: 'Download JSON', exact: true }).count()).toBe(
          0,
        );
        expect(
          await page.evaluate(() => {
            const state = window as unknown as {
              extensionAborted: number;
              extensionCreated: string[];
              extensionRevoked: string[];
            };
            return (
              state.extensionAborted >= 2 &&
              state.extensionCreated.every((url) => state.extensionRevoked.includes(url))
            );
          }),
        ).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await page.close();
      }
    },
  );
});
