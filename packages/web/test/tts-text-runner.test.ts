import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/TtsTextHarness.svelte'); }, 30000);
afterAll(async () => { await harness?.close(); });

it('offers an MP3 download without treating audio as text', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    await page.getByLabel('Input text').fill('Hello');
    await page.getByRole('button', { name: 'Run Text to Speech' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.mp3$/);
    const path = await file.path();
    if (!path) throw new Error('No download path');
    expect([...await readFile(path)]).toEqual([73, 68, 51, 3]);
    expect(await page.getByRole('region', { name: 'Text result' }).count()).toBe(0);
  } finally { await page.close(); }
}, 30000);
