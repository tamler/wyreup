import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { openBrowserHarness } from './browserHarness';
async function result(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  const path = await (await event).path();
  if (!path) throw new Error('Missing cron artifact');
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
}
describe('actual cron through mounted UtilityRunner', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/CronUtilityHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });
  it('uses explicit anchor and timezone with DOM/DOW OR and saves every next run', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      expect(await page.locator('input[type=file]').count()).toBe(0);
      await page
        .getByLabel('Mode', { exact: true })
        .selectOption({ label: 'Five fields and next runs' });
      await page.getByLabel('Minute (0–59)', { exact: true }).fill('0');
      await page.getByLabel('Hour (0–23)', { exact: true }).fill('0');
      await page.getByLabel('Day of month (1–31)', { exact: true }).fill('1');
      await page.getByLabel('Day of week (0–7; Sunday 0 or 7)', { exact: true }).fill('1');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('alert').waitFor();
      expect(await page.getByRole('button', { name: 'Download JSON', exact: true }).count()).toBe(
        0,
      );
      await page
        .getByLabel('Start instant (ISO with Z or offset)', { exact: true })
        .fill('2026-01-02T00:00:00.000Z');
      await page.getByLabel('IANA timezone', { exact: true }).fill('UTC');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
      expect(await result(page)).toMatchObject({
        cron: '0 0 1 * 1',
        timezone: 'UTC',
        currentDate: '2026-01-02T00:00:00.000Z',
        nextRuns: [
          '2026-01-05T00:00:00.000Z',
          '2026-01-12T00:00:00.000Z',
          '2026-01-19T00:00:00.000Z',
          '2026-01-26T00:00:00.000Z',
          '2026-02-01T00:00:00.000Z',
        ],
        dayMatching: 'OR when both day-of-month and day-of-week are restricted',
      });
      await page.getByLabel('IANA timezone', { exact: true }).fill('America/New_York');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
      expect(await result(page)).toMatchObject({
        timezone: 'America/New_York',
        nextRuns: [
          '2026-01-05T05:00:00.000Z',
          '2026-01-12T05:00:00.000Z',
          '2026-01-19T05:00:00.000Z',
          '2026-01-26T05:00:00.000Z',
          '2026-02-01T05:00:00.000Z',
        ],
      });
    } finally {
      await page.close();
    }
  });
  it('preserves natural-language mode without creating an input file', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await page.getByLabel('description', { exact: true }).fill('every weekday at 9am');
      await page.getByRole('button', { name: 'Calculate', exact: true }).click();
      await page.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
      expect(await result(page)).toMatchObject({ cron: '0 9 * * 1,2,3,4,5', confidence: 'high' });
    } finally {
      await page.close();
    }
  });
});
