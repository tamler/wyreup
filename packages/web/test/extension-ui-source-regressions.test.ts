import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('independent preloaded color failure regressions', () => {
  it.each(['oversize', 'read-error'])(
    'suppresses default amber artifacts for %s and recovers on manual edit',
    async (preload) => {
      const page = await color.browser.newPage();
      page.setDefaultTimeout(2000);
      try {
        await page.goto(`${color.url}?preload=${preload}`);
        await page.locator('.error-panel, .result-panel').waitFor();
        await page.waitForTimeout(100);
        expect.soft(await page.getByRole('alert').count()).toBe(1);
        expect.soft(await page.locator('.result-panel').count()).toBe(0);
        expect
          .soft(await page.getByRole('button', { name: 'Download JSON', exact: true }).count())
          .toBe(0);
        const probe = await page.evaluate(
          () =>
            (window as unknown as { colorFixture: { reads: number; runs: number } }).colorFixture,
        );
        expect.soft(probe.runs).toBe(0);
        expect.soft(probe.reads).toBe(preload === 'oversize' ? 0 : 1);
        await page.getByLabel('Color string', { exact: true }).fill('#123456');
        await page.getByText('#123456', { exact: true }).first().waitFor();
        await page.getByRole('button', { name: 'Download JSON', exact: true }).waitFor();
        expect(await page.getByRole('alert').count()).toBe(0);
      } finally {
        await page.close();
      }
    },
    30000,
  );
  it('clears an already-successful copied notice on a subsequent color edit', async () => {
    const page = await color.browser.newPage();
    try {
      await page.addInitScript(() =>
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.resolve() },
        }),
      );
      await page.goto(color.url);
      await page.getByLabel('Color string', { exact: true }).fill('#ff0000');
      await page.getByRole('button', { name: 'Copy HEX', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Copy HEX', exact: true }).click();
      await page.getByText('Copied HEX.', { exact: true }).waitFor();
      await page.getByLabel('Color string', { exact: true }).fill('#0000ff');
      await page.getByText('hsl(240, 100%, 50%)', { exact: true }).waitFor();
      expect(await page.getByRole('status').filter({ hasText: 'Copied' }).count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 30000);
  it('retains the last valid picker color through invalid typed input', async () => {
    const page = await color.browser.newPage();
    try {
      await page.goto(color.url);
      await page.getByLabel('Color string', { exact: true }).fill('#008000');
      await page.getByText('hsl(120, 100%, 25%)', { exact: true }).waitFor();
      expect(await page.getByLabel('Color picker', { exact: true }).inputValue()).toBe('#008000');
      await page.getByLabel('Color string', { exact: true }).fill('invalid color');
      await page.getByText("Couldn't parse that color.", { exact: false }).waitFor();
      expect(await page.getByLabel('Color picker', { exact: true }).inputValue()).toBe('#008000');
      expect(await page.getByLabel('Color string', { exact: true }).inputValue()).toBe(
        'invalid color',
      );
    } finally {
      await page.close();
    }
  }, 30000);
});

it.each(['oversize', 'read-error'])(
  'suppresses empty live artifacts after a %s preload and resumes after editing',
  async (preload) => {
    const page = await live.browser.newPage();
    try {
      await page.goto(`${live.url}?preload=${preload}`);
      await page
        .getByText(
          preload === 'oversize' ? /Live input exceeds 1 MiB/ : /Controlled live file read failure/,
        )
        .waitFor();
      await page.waitForTimeout(450);
      expect.soft(await page.getByRole('alert').count()).toBe(1);
      expect.soft(await page.getByLabel('Live result', { exact: true }).count()).toBe(0);
      expect
        .soft(await page.getByRole('button', { name: 'Download result', exact: true }).count())
        .toBe(0);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { textFixture: { preloadProbe: { reads: number } } }).textFixture
              .preloadProbe.reads,
        ),
      ).toBe(preload === 'oversize' ? 0 : 1);
      await page.getByLabel('Input text', { exact: true }).fill('hello world');
      await page.getByLabel('Live result', { exact: true }).waitFor();
      expect(await page.getByRole('alert').count()).toBe(0);
    } finally {
      await page.close();
    }
  },
  30000,
);

it('keeps Base64 binary decode download-only without reading the decoded Blob as text', async () => {
  const page = await binary.browser.newPage();
  const expected = Buffer.from([0, 255, 1, 128]);
  try {
    await page.goto(binary.url);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Drop file or click to browse/ }).click();
    await (
      await chooser
    ).setFiles({ name: 'binary.txt', mimeType: 'text/plain', buffer: Buffer.from('AP8BgA==') });
    await page.getByLabel('mode', { exact: true }).selectOption({ label: 'decode (Base64 → binary)' });
    await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
    await page.getByRole('button', { name: 'Download', exact: true }).waitFor();
    expect
      .soft(await page.getByRole('region', { name: 'Text result', exact: true }).count())
      .toBe(0);
    expect.soft(await page.getByRole('button', { name: 'Copy', exact: true }).count()).toBe(0);
    expect
      .soft(await page.getByRole('button', { name: 'Speak this text aloud', exact: true }).count())
      .toBe(0);
    expect
      .soft(
        await page
          .getByRole('status')
          .filter({ hasText: /binary.*download|download.*binary/i })
          .count(),
      )
      .toBe(1);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const artifact = await download;
    expect(artifact.suggestedFilename()).toBe('binary-base64.bin');
    const path = await artifact.path();
    if (!path) throw new Error('Missing binary download.');
    expect(await readFile(path)).toEqual(expected);
    const reads = await page.evaluate(
      () => (window as unknown as { textReads: number[] }).textReads,
    );
    // Actual base64 input text is 8 bytes; the decoded output is 4 bytes.
    expect.soft(reads.filter((size) => size === expected.length)).toEqual([]);
    expect(reads.filter((size) => size === 8)).toHaveLength(1);
  } finally {
    await page.close();
  }
}, 30000);

it('retains valid UTF-8 Base64 decode preview and copy without corrupting its download', async () => {
  const page = await binary.browser.newPage();
  try {
    await page.goto(binary.url);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Drop file or click to browse/ }).click();
    await (
      await chooser
    ).setFiles({
      name: 'hello.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('SGVsbG8='),
    });
    await page.getByLabel('mode', { exact: true }).selectOption({ label: 'decode (Base64 → binary)' });
    await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
    const preview = page.getByRole('region', { name: 'Text result', exact: true });
    await preview.waitFor();
    expect(await preview.textContent()).toBe('Hello');
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
    expect(
      await page.evaluate(() => (window as unknown as { textCopied: string }).textCopied),
    ).toBe('Hello');
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    const artifact = await event;
    const path = await artifact.path();
    if (!path) throw new Error('Missing valid UTF-8 decoded artifact.');
    expect(artifact.suggestedFilename()).toBe('hello-base64.bin');
    expect(await readFile(path)).toEqual(Buffer.from('Hello'));
  } finally {
    await page.close();
  }
}, 30000);

it('removes Markdown form controls and submission attributes from the live preview', async () => {
  const page = await live.browser.newPage();
  try {
    await page.goto(`${live.url}?tool=markdown-to-html`);
    await page
      .getByLabel('Input text', { exact: true })
      .fill(
        '<form action="https://remote.invalid/submit"><input name="secret"><button formaction="https://remote.invalid/alternate">Send</button><textarea>text</textarea><select><option>x</option></select></form>\n\n# Reviewed',
      );
    await page.getByRole('heading', { name: 'Reviewed', exact: true }).waitFor();
    const preview = page.getByRole('region', { name: 'Safe HTML preview', exact: true });
    expect(
      await preview
        .locator('form,input,button,textarea,select,option,[action],[formaction]')
        .count(),
    ).toBe(0);
  } finally {
    await page.close();
  }
}, 30000);

it('downloads self-describing UTF-8 Markdown HTML that reopens with literal Unicode', async () => {
  const page = await live.browser.newPage();
  const dir = await mkdtemp(join(tmpdir(), 'wyreup-extension-unicode-'));
  let reopened: Awaited<ReturnType<typeof live.browser.newPage>> | null = null;
  try {
    await page.goto(`${live.url}?tool=markdown-to-html`);
    await page.getByLabel('Input text', { exact: true }).fill('# Café 中文 🐱');
    await page.getByRole('heading', { name: 'Café 中文 🐱', exact: true }).waitFor();
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download result', exact: true }).click();
    const saved = join(dir, 'safe.html');
    await (await event).saveAs(saved);
    const html = await readFile(saved, 'utf8');
    expect.soft(html).toMatch(/^<!doctype html>/i);
    expect.soft(html).toMatch(/<meta\s+charset=["']?utf-8["']?\s*\/?\s*>/i);
    expect(html).toContain('Café 中文 🐱');
    reopened = await live.browser.newPage();
    await reopened.goto(pathToFileURL(saved).href);
    expect.soft(await reopened.evaluate(() => document.characterSet)).toBe('UTF-8');
    expect(await reopened.locator('h1').textContent()).toBe('Café 中文 🐱');
  } finally {
    await reopened?.close();
    await page.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
