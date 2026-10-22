import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openBrowserHarness } from './browserHarness';

describe('actual advanced color source and opaque picker', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/ColorHarness.svelte'); }, 30000);
  afterAll(async () => { await harness?.close(); });
  it('preserves typed alpha through picker synchronization and full JSON download', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await page.getByLabel('Color string', { exact: true }).fill('rgba(255, 0, 0, 0.5)');
      await page.getByText('Alpha: 0.5. Gamut: srgb.', { exact: true }).waitFor();
      expect(await page.getByLabel('Color string', { exact: true }).inputValue()).toBe('rgba(255, 0, 0, 0.5)');
      expect(await page.getByLabel('Color picker', { exact: true }).inputValue()).toBe('#ff0000');
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
      const path = await (await download).path(); if (!path) throw new Error('No color artifact.');
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ alpha: 0.5, input: 'rgba(255, 0, 0, 0.5)' });
      await page.getByLabel('Color picker', { exact: true }).fill('#008000');
      await page.getByText('Alpha: 1. Gamut: srgb.', { exact: true }).waitFor();
      expect(await page.getByLabel('Color string', { exact: true }).inputValue()).toBe('#008000');
      expect(await page.getByRole('status').innerText()).toContain('opaque sRGB');
    } finally { await page.close(); }
  }, 30000);
  it('keeps wide-gamut input and reports clipboard failure visibly', async () => {
    const page = await harness.browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } }); });
      await page.goto(harness.url);
      await page.getByLabel('Color string', { exact: true }).fill('color(display-p3 1 0 0)');
      await page.getByText('Alpha: 1. Gamut: outside-srgb.', { exact: true }).waitFor();
      expect(await page.getByLabel('Color string', { exact: true }).inputValue()).toBe('color(display-p3 1 0 0)');
      await page.getByRole('button', { name: 'Copy RGB', exact: true }).click();
      expect(await page.getByRole('status').innerText()).toContain('Copy unavailable');
      await page.getByLabel('Color string', { exact: true }).fill('not a color');
      await page.getByText("Couldn't parse that color.", { exact: false }).waitFor();
      expect(await page.getByRole('button', { name: 'Download JSON', exact: true }).count()).toBe(0);
    } finally { await page.close(); }
  }, 30000);
});
