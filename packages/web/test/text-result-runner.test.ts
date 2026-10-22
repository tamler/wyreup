import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { openBrowserHarness } from './browserHarness';

interface TextState {
  textFinish: () => void;
  textReject: () => void;
  textCopied: string;
  textCopyFailure: boolean;
  textAborted: number;
  textCreated: string[];
  textRevoked: string[];
  textReads: number[];
}

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
);
async function upload(page: Page, name: string, mimeType: string, buffer: Buffer) {
  const event = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Drop file or click to browse/ }).click();
  await (await event).setFiles({ name, mimeType, buffer });
}
async function download(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const artifact = await event;
  const path = await artifact.path();
  if (!path) throw new Error('Missing text artifact');
  return { name: artifact.suggestedFilename(), bytes: await readFile(path) };
}
describe('mounted existing text-result extensions', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/TextResultHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });
  it('clears a previous output on parameter changes and revokes its owned URL on unmount', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await upload(page, 'a.txt', 'text/plain', Buffer.from('hello'));
      await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
      await page.getByRole('region', { name: 'Text result' }).waitFor();
      expect((await download(page)).bytes.toString()).toBe('aGVsbG8=');
      await page.getByLabel('URL-safe').check();
      expect(await page.getByRole('region', { name: 'Text result' }).count()).toBe(0);
      expect(await page.evaluate(() => (window as unknown as TextState).textRevoked)).toEqual(
        await page.evaluate(() => (window as unknown as TextState).textCreated),
      );
      await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
      await page.getByRole('region', { name: 'Text result' }).waitFor();
      await download(page);
      await page.getByRole('button', { name: 'Unmount text runner' }).click();
      expect(await page.evaluate(() => (window as unknown as TextState).textRevoked)).toEqual(
        await page.evaluate(() => (window as unknown as TextState).textCreated),
      );
    } finally {
      await page.close();
    }
  });
  it('encodes complete image data/CSS URLs, copies literal text and reports clipboard failures', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await upload(page, 'pixel.png', 'image/png', png);
      await page.getByLabel('Encode output').selectOption({ label: 'Image data URL' });
      await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
      const expected = `data:image/png;base64,${png.toString('base64')}`;
      await expectText(page, expected);
      await page.getByRole('button', { name: 'Copy', exact: true }).click();
      await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
      expect(await page.evaluate(() => (window as unknown as TextState).textCopied)).toBe(expected);
      expect((await download(page)).bytes.toString()).toBe(expected);
      await page.getByLabel('Encode output').selectOption({ label: 'CSS image URL' });
      await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
      await expectText(page, `url("${expected}")`);
      await page.evaluate(() => {
        (window as unknown as TextState).textCopyFailure = true;
      });
      await page.getByRole('button', { name: 'Copy', exact: true }).click();
      await page
        .getByText('Copy unavailable. Download the result instead.', { exact: true })
        .waitFor();
      await upload(page, 'encoded.txt', 'text/plain', Buffer.from(png.toString('base64')));
      await page.getByLabel('mode', { exact: true }).selectOption({ label: 'decode (Base64 → binary)' });
      await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
      expect(await page.getByRole('alert').allTextContents()).toEqual([]);
      await page.getByRole('button', { name: 'Download', exact: true }).waitFor();
      expect((await download(page)).bytes).toEqual(png);
    } finally {
      await page.close();
    }
  });
  it('does not read or render image output above 256 KiB but downloads every byte', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      const input = Buffer.concat([png, Buffer.alloc(200000, 7)]);
      await upload(page, 'large.png', 'image/png', input);
      await page.getByLabel('Encode output').selectOption({ label: 'Image data URL' });
      await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
      await page.getByText(/Inline preview and copy are limited to 256 KiB/).waitFor();
      expect(await page.getByRole('region', { name: 'Text result' }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Copy', exact: true }).count()).toBe(0);
      const expected = `data:image/png;base64,${input.toString('base64')}`;
      expect(await page.evaluate(() => (window as unknown as TextState).textReads)).not.toContain(
        Buffer.byteLength(expected),
      );
      expect((await download(page)).bytes.toString()).toBe(expected);
    } finally {
      await page.close();
    }
  });
  it('keeps raw large encoding and binary decoding available, including empty output', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      const input = Buffer.alloc(300000, 255);
      await upload(page, 'raw.bin', 'application/octet-stream', input);
      await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
      await page.getByRole('region', { name: 'Text result' }).waitFor();
      expect((await download(page)).bytes.toString()).toBe(input.toString('base64'));
      await upload(page, 'bytes.txt', 'text/plain', Buffer.from('AP8BgA=='));
      await page.getByLabel('mode', { exact: true }).selectOption({ label: 'decode (Base64 → binary)' });
      await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
      await page.getByRole('button', { name: 'Download', exact: true }).waitFor();
      expect((await download(page)).bytes).toEqual(Buffer.from([0, 255, 1, 128]));
      await upload(page, 'empty.txt', 'text/plain', Buffer.alloc(0));
      await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
      await page.getByRole('button', { name: 'Download', exact: true }).waitFor();
      expect((await download(page)).bytes.length).toBe(0);
    } finally {
      await page.close();
    }
  });
  it('preserves CSV cell values, quoted newlines and the full requested delimiter download', async () => {
    const page = await harness.browser.newPage({ viewport: { width: 390, height: 844 } });
    const captureDir = await mkdtemp(join(tmpdir(), 'wyreup-csv-view-'));
    try {
      await page.goto(`${harness.url}?kind=csv`);
      await upload(
        page,
        'source.csv',
        'text/csv',
        Buffer.from('a,b\r\n"x,y",""\r\n"line1\nline2",03\r\n'),
      );
      await page.getByLabel('Conversion', { exact: true }).selectOption({ label: 'Change CSV delimiter' });
      await page.getByLabel('Target delimiter', { exact: true }).selectOption({ label: 'Tab' });
      await page.getByRole('button', { name: 'Run CSV ↔ JSON', exact: true }).click();
      const expected = '"a"\t"b"\r\n"x,y"\t""\r\n"line1\nline2"\t"03"\r\n';
      await page.getByRole('region', { name: 'Text result' }).waitFor();
      const output = await download(page);
      expect(output.bytes.toString()).toBe(expected);
      expect(output.name).toBe('source-csv-json.csv');
      await page.screenshot({
        path: join(captureDir, 'mobile.png'),
        fullPage: true,
      });
    } finally {
      await page.close();
      await rm(captureDir, { recursive: true, force: true });
    }
  });
  for (const finish of ['textFinish', 'textReject'] as const) {
    it(`ignores late ${finish === 'textFinish' ? 'success' : 'failure'} after cancellation and unmount`, async () => {
      const page = await harness.browser.newPage();
      try {
        await page.goto(harness.url);
        await upload(page, 'a.txt', 'text/plain', Buffer.from('hello'));
        await page.getByLabel('Execution').selectOption('deferred');
        await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
        await page.waitForFunction(
          () => typeof (window as unknown as TextState).textFinish === 'function',
        );
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.evaluate((key) => {
          (window as unknown as TextState)[key]();
        }, finish);
        await page.getByRole('button', { name: 'Run Base64', exact: true }).waitFor();
        expect(await page.getByRole('region', { name: 'Text result' }).count()).toBe(0);
        expect(await page.getByRole('alert').count()).toBe(0);
        expect(await page.evaluate(() => (window as unknown as TextState).textAborted)).toBe(1);
        await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
        await page.waitForFunction(() => (window as unknown as TextState).textAborted === 1);
        await page.getByRole('button', { name: 'Unmount text runner' }).click();
        await page.evaluate((key) => {
          (window as unknown as TextState)[key]();
        }, finish);
        expect(await page.evaluate(() => (window as unknown as TextState).textAborted)).toBe(2);
      } finally {
        await page.close();
      }
    });
  }
  it('cancels pending work on a file or parameter change and ignores its old output', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(harness.url);
      await upload(page, 'old.txt', 'text/plain', Buffer.from('old'));
      await page.getByLabel('Execution').selectOption('deferred');
      await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
      await page.waitForFunction(
        () => typeof (window as unknown as TextState).textFinish === 'function',
      );
      await upload(page, 'new.txt', 'text/plain', Buffer.from('new'));
      await page.evaluate(() => {
        (window as unknown as TextState).textFinish();
      });
      await page.getByRole('button', { name: 'Run Base64', exact: true }).waitFor();
      expect(await page.getByRole('region', { name: 'Text result' }).count()).toBe(0);
      expect(await page.evaluate(() => (window as unknown as TextState).textAborted)).toBe(1);
      await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
      await page.getByLabel('URL-safe').check();
      await page.evaluate(() => {
        (window as unknown as TextState).textReject();
      });
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(await page.evaluate(() => (window as unknown as TextState).textAborted)).toBe(2);
      await page.getByLabel('Execution').selectOption('normal');
      await page.getByRole('button', { name: 'Run Base64', exact: true }).click();
      await expectText(page, 'bmV3');
    } finally {
      await page.close();
    }
  });
});
async function expectText(page: Page, expected: string) {
  await page.getByRole('region', { name: 'Text result' }).waitFor();
  expect(await page.getByRole('region', { name: 'Text result' }).textContent()).toBe(expected);
}
