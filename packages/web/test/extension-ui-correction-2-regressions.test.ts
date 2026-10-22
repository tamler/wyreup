import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

let color: Awaited<ReturnType<typeof openBrowserHarness>>;
let live: Awaited<ReturnType<typeof openBrowserHarness>>;
let binary: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => {
  color = await openBrowserHarness('./test/fixtures/ColorHarness.svelte');
  live = await openBrowserHarness('./test/fixtures/LiveTextHarness.svelte');
  binary = await openBrowserHarness('./test/fixtures/TextResultHarness.svelte');
}, 30000);
afterAll(async () => {
  await Promise.allSettled([color?.close(), live?.close(), binary?.close()]);
});

it('publishes the actual color result after an identical-value input event during pending delivery', async () => {
  const page = await color.browser.newPage();
  try {
    await page.goto(`${color.url}?deferred=1`);
    await page.waitForFunction(
      () =>
        (window as unknown as { colorFixture: { pending: unknown[] } }).colorFixture.pending
          .length === 1,
    );
    const input = page.getByLabel('Color string', { exact: true });
    expect(await input.inputValue()).toBe('#ffb000');
    await input.dispatchEvent('input');
    await page.waitForTimeout(100);
    await page.evaluate(() =>
      (
        window as unknown as { colorFixture: { pending: { release: () => void }[] } }
      ).colorFixture.pending.forEach((item) => item.release()),
    );
    await page.waitForTimeout(200);
    expect.soft(await page.locator('.result-panel').count()).toBe(1);
    expect
      .soft(await page.getByRole('button', { name: 'Download JSON', exact: true }).count())
      .toBe(1);
    expect(await page.getByRole('alert').count()).toBe(0);
    if (await page.locator('.result-panel').count()) {
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
      const path = await (await event).path();
      if (!path) throw new Error('Missing actual color artifact.');
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
        input: '#ffb000',
        hex: '#ffb000',
        valid: true,
      });
    }
  } finally {
    await page.close();
  }
}, 30000);

it('displays actual UTF-8 Base64 decoded HTML literally without host CSS or automatic requests', async () => {
  const page = await binary.browser.newPage();
  const source =
    '<div><style>body{--wyreup-decoded-probe:applied}</style><img src="https://decode.invalid/pixel"><p>literal</p></div>';
  const expected = Buffer.from(source, 'utf8');
  const requests: string[] = [];
  await page.route('https://decode.invalid/**', async (route) => {
    requests.push(route.request().url());
    await route.abort();
  });
  try {
    await page.goto(binary.url);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Drop file or click to browse/ }).click();
    await (
      await chooser
    ).setFiles({
      name: 'encoded.html',
      mimeType: 'text/html',
      buffer: Buffer.from(expected.toString('base64')),
    });
    await page.getByLabel('mode', { exact: true }).selectOption({ label: 'decode (Base64 → binary)' });
    await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
    await page.getByRole('button', { name: 'Download', exact: true }).waitFor();
    await page.waitForTimeout(100);
    const preview = page.getByRole('region', { name: 'Text result', exact: true });
    expect.soft(await preview.count()).toBe(1);
    if (await preview.count()) expect(await preview.textContent()).toBe(source);
    expect
      .soft(await page.getByRole('region', { name: 'HTML result', exact: true }).count())
      .toBe(0);
    expect.soft(await page.locator('.result-panel img, .result-panel style').count()).toBe(0);
    expect
      .soft(
        await page.evaluate(() =>
          getComputedStyle(document.body).getPropertyValue('--wyreup-decoded-probe'),
        ),
      )
      .toBe('');
    expect.soft(requests).toEqual([]);
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const artifact = await event;
    const path = await artifact.path();
    if (!path) throw new Error('Missing decoded HTML byte artifact.');
    expect(artifact.suggestedFilename()).toBe('encoded-base64.bin');
    expect(await readFile(path)).toEqual(expected);
  } finally {
    await page.close();
  }
}, 30000);

it('preserves a successful real color preload without a default amber result', async () => {
  const page = await color.browser.newPage();
  try {
    await page.goto(`${color.url}?preload=valid`);
    await page.getByText('hsl(120, 100%, 25%)', { exact: true }).waitFor();
    expect(await page.getByLabel('Color string', { exact: true }).inputValue()).toBe('#008000');
    expect(await page.getByRole('alert').count()).toBe(0);
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    const path = await (await event).path();
    if (!path) throw new Error('Missing valid color preload artifact.');
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      input: '#008000',
      hex: '#008000',
      valid: true,
    });
  } finally {
    await page.close();
  }
}, 30000);

it('rejects malformed UTF-8 live preload without an altered input or artifact', async () => {
  const page = await live.browser.newPage();
  try {
    await page.goto(`${live.url}?preload=invalid-utf8`);
    await page.locator('[role=alert], [aria-label="Live result"]').waitFor();
    expect.soft(await page.getByRole('alert').count()).toBe(1);
    expect.soft(await page.getByLabel('Input text', { exact: true }).inputValue()).toBe('');
    expect.soft(await page.getByLabel('Live result', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Download result', exact: true }).count()).toBe(
      0,
    );
  } finally {
    await page.close();
  }
}, 30000);

it('bounds actual live preload reading despite an understated File size', async () => {
  const page = await live.browser.newPage();
  try {
    await page.goto(`${live.url}?preload=understated`);
    await page.getByRole('alert').waitFor();
    expect.soft((await page.getByLabel('Input text', { exact: true }).inputValue()).length).toBe(0);
    expect(await page.getByLabel('Live result', { exact: true }).count()).toBe(0);
    const sizes = await page.evaluate(() => {
      const probe = (
        window as unknown as {
          textFixture: { preloadProbe: { textReadSizes: number[]; bufferReadSizes: number[] } };
        }
      ).textFixture.preloadProbe;
      return [...probe.textReadSizes, ...probe.bufferReadSizes];
    });
    expect(sizes.length).toBeGreaterThan(0);
    // One detection byte beyond the 1 MiB accepted payload is permitted.
    expect.soft(sizes.every((size) => size <= 1024 * 1024 + 1)).toBe(true);
    expect(await page.getByRole('button', { name: 'Download result', exact: true }).count()).toBe(
      0,
    );
  } finally {
    await page.close();
  }
}, 30000);

it('preserves valid Unicode live preload and its actual complete word-counter artifact', async () => {
  const page = await live.browser.newPage();
  try {
    await page.goto(`${live.url}?preload=valid`);
    await page.getByLabel('Live result', { exact: true }).waitFor();
    expect(await page.getByLabel('Input text', { exact: true }).inputValue()).toBe('Café 中文');
    expect(await page.getByRole('alert').count()).toBe(0);
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download result', exact: true }).click();
    const path = await (await event).path();
    if (!path) throw new Error('Missing valid Unicode preload artifact.');
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
      words: 2,
      characters: 7,
      utf8Bytes: 12,
    });
  } finally {
    await page.close();
  }
}, 30000);
