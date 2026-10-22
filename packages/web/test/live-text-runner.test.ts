import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openBrowserHarness } from './browserHarness';

describe('mounted live local text and full artifacts', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/LiveTextHarness.svelte');
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });

  it.each([
    { width: 1200, height: 800 },
    { width: 390, height: 844 },
  ])(
    'computes empty and Unicode word counts with accessible controls at $width pixels',
    async (viewport) => {
      const page = await harness.browser.newPage({ viewport });
      try {
        await page.goto(harness.url);
        await page.getByLabel('Live result').waitFor();
        const event = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download result' }).click();
        const path = await (await event).path();
        if (!path) throw new Error('Missing result file.');
        expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
          words: 0,
          characters: 0,
          utf8Bytes: 0,
        });
        await page.getByLabel('Input text').focus();
        await page.keyboard.insertText('a👩‍💻');
        await page.waitForTimeout(400);
        const next = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download result' }).click();
        const nextPath = await (await next).path();
        if (!nextPath) throw new Error('Missing Unicode result.');
        expect(JSON.parse(await readFile(nextPath, 'utf8'))).toMatchObject({
          characters: 6,
          codePoints: 4,
          graphemes: 2,
          utf8Bytes: 12,
        });
        await page.getByLabel('Speaking words per minute').fill('');
        await page.waitForTimeout(400);
        expect(await page.getByLabel('Live result').count()).toBe(0);
        expect(await page.locator('[aria-invalid="true"]').count()).toBeGreaterThan(0);
        await page.getByLabel('Speaking words per minute').fill('150');
        await page.getByLabel('Live result').waitFor();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
      } finally {
        await page.close();
      }
    },
    30000,
  );

  it('rejects an oversized real chained File before reading its bytes', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?preload=oversize`);
      await page.getByText(/Live input exceeds 1 MiB/).waitFor();
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { textFixture: { preloadProbe: { reads: number } } }).textFixture
              .preloadProbe.reads,
        ),
      ).toBe(0);
      expect(await page.getByLabel('Input text').inputValue()).toBe('');
    } finally {
      await page.close();
    }
  }, 30000);

  it('sanitizes once for preview, copy and a reopened Markdown download with no resource requests', async () => {
    const page = await harness.browser.newPage();
    const resources: string[] = [];
    const errors: string[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith('https://remote.invalid')) resources.push(request.url());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const dir = await mkdtemp(join(tmpdir(), 'wyreup-live-html-'));
    try {
      await page.addInitScript(() =>
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: (text: string) => {
              Object.assign(window, { copiedLiveText: text });
              return Promise.resolve();
            },
          },
        }),
      );
      await page.goto(`${harness.url}?tool=markdown-to-html`);
      await page.getByLabel('Live result').waitFor();
      expect(await page.getByText('37 output bytes — Empty output.', { exact: true }).count()).toBe(
        1,
      );
      await page
        .getByLabel('Input text')
        .fill(
          '# Hi\n![remote](https://remote.invalid/pixel.png)\n<script>window.pwned=1</script>\n[x](javascript:alert(1))',
        );
      await page.getByRole('heading', { name: 'Hi', exact: true }).waitFor();
      const preview = await page.getByLabel('Safe HTML preview').innerHTML();
      expect(
        await page.getByLabel('Safe HTML preview').locator('img,script,[onerror],[src]').count(),
      ).toBe(0);
      await page.getByRole('button', { name: 'Copy result' }).click();
      expect(
        await page.evaluate(() => (window as unknown as { copiedLiveText: string }).copiedLiveText),
      ).toBe(preview);
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download result' }).click();
      const download = await event;
      const saved = join(dir, 'safe.html');
      await download.saveAs(saved);
      const text = await readFile(saved, 'utf8');
      expect(text).toBe('<!doctype html><meta charset="utf-8">' + preview);
      const reopened = await harness.browser.newPage();
      reopened.on('request', (request) => {
        if (request.url().startsWith('https://remote.invalid')) resources.push(request.url());
      });
      await reopened.goto(`file://${saved}`);
      expect(await reopened.evaluate(() => document.characterSet)).toBe('UTF-8');
      expect(await reopened.locator('body').innerHTML()).toBe(preview);
      expect(await reopened.getByRole('heading', { name: 'Hi' }).count()).toBe(1);
      expect(await reopened.locator('img,script,[onerror],[src]').count()).toBe(0);
      await reopened.close();
      expect(resources).toEqual([]);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => 'pwned' in window)).toBe(false);
      await page.evaluate(() =>
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error('denied')) },
        }),
      );
      await page.getByRole('button', { name: 'Copy result' }).click();
      await page.getByText('Copy unavailable. Use Download.', { exact: true }).waitFor();
    } finally {
      await page.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);

  it('shows literal JSONPath values, pages25 rows and saves every returned match', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?tool=json-path`);
      await page.getByLabel('JSONPath', { exact: true }).fill('$.items[*]');
      const values = Array.from({ length: 60 }, (_, index) =>
        index === 0 ? '<img src="https://remote.invalid/pixel" onerror="alert(1)">' : index,
      );
      await page.getByLabel('Input text').fill(JSON.stringify({ items: values }));
      await page.getByLabel('JSONPath matches').waitFor();
      expect(await page.locator('tbody tr').count()).toBe(25);
      expect(await page.locator('tbody img').count()).toBe(0);
      expect(await page.locator('tbody tr').first().textContent()).toContain('$.items[0]');
      await page.getByRole('button', { name: 'Next matches' }).click();
      expect(await page.locator('tbody tr').first().textContent()).toContain('$.items[25]');
      await page.getByRole('button', { name: 'Next matches' }).click();
      expect(await page.locator('tbody tr').count()).toBe(10);
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download result' }).click();
      const path = await (await event).path();
      if (!path) throw new Error('Missing full JSONPath output.');
      const data = JSON.parse(await readFile(path, 'utf8')) as {
        matches: { path: string; value: unknown }[];
      };
      expect(data.matches).toHaveLength(60);
      expect(data.matches[0]).toEqual({ path: '$.items[0]', value: values[0] });
      expect(data.matches[59]).toEqual({ path: '$.items[59]', value: 59 });
      await page.getByLabel('limit', { exact: true }).fill('3');
      await page.getByText('Limited: 3 of 60 matches returned.', { exact: true }).waitFor();
      expect(await page.locator('tbody tr').count()).toBe(3);
      await page.getByRole('button', { name: 'Clear input' }).click();
      expect(await page.getByLabel('Live result').count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 30000);

  it('paginates an actual4096 subnet split and saves the full result', async () => {
    const page = await harness.browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(`${harness.url}?tool=subnets`);
      expect(await page.locator('tbody tr').count()).toBe(25);
      expect(await page.locator('tbody tr').first().textContent()).toContain('10.0.0.0/20');
      await page.getByRole('button', { name: 'Next subnets' }).click();
      expect(await page.locator('tbody tr').first().textContent()).toContain('10.1.144.0/20');
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download all subnets' }).click();
      const path = await (await event).path();
      if (!path) throw new Error('Missing subnet artifact.');
      const data = JSON.parse(await readFile(path, 'utf8')) as {
        subnetCount: number;
        subnets: { network: string; prefix: number }[];
      };
      expect(data.subnetCount).toBe(4096);
      expect(data.subnets).toHaveLength(4096);
      expect(data.subnets[4095]).toMatchObject({ network: '10.255.240.0', prefix: 20 });
    } finally {
      await page.close();
    }
  }, 30000);

  it('invalidates stale success/error/progress on input changes, cancel and unmount', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?tool=json-formatter&deferred=1`);
      await page.getByLabel('Input text').fill('{}');
      await page.waitForTimeout(400);
      await page.getByLabel('Input text').fill(' ');
      await page.evaluate(() =>
        (
          window as unknown as { textFixture: { release(index: number, outcome: string): void } }
        ).textFixture.release(0, 'error'),
      );
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(await page.getByLabel('Live result').count()).toBe(0);
      await page.getByLabel('Input text').fill('{"new":1}');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: 'Cancel calculation' }).click();
      await page.evaluate(() =>
        (
          window as unknown as { textFixture: { release(index: number, outcome: string): void } }
        ).textFixture.release(1, 'success'),
      );
      await page.waitForTimeout(50);
      expect(await page.getByLabel('Live result').count()).toBe(0);
      expect(await page.getByText('stale progress', { exact: true }).count()).toBe(0);
      await page.getByLabel('Input text').fill('{}');
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: 'Unmount runner' }).click();
      await page.evaluate(() =>
        (
          window as unknown as { textFixture: { release(index: number, outcome: string): void } }
        ).textFixture.release(2, 'error'),
      );
      await page.waitForTimeout(50);
      expect(await page.getByRole('alert').count()).toBe(0);
    } finally {
      await page.close();
    }
  }, 30000);

  it.each(['remove-duplicate-lines-online', 'javascript-minifier', 'number-base-converter'])(
    'keeps zero-byte Copy/Download visible for allowed manual empty %s',
    async (id) => {
      const page = await harness.browser.newPage();
      try {
        await page.goto(`${harness.url}?tool=${id}&manual=1`);
        if (id === 'number-base-converter')
          await page.getByLabel('Conversion', { exact: true }).selectOption({ label: 'UTF-8 bytes (plain text)' });
        await page.getByRole('button', { name: /^Run / }).click();
        await page.getByText('0 output bytes — Empty output.', { exact: true }).waitFor();
        expect(await page.getByRole('button', { name: 'Copy', exact: true }).count()).toBe(1);
        const event = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download', exact: true }).click();
        const path = await (await event).path();
        if (!path) throw new Error('Missing empty output.');
        expect((await readFile(path)).length).toBe(0);
      } finally {
        await page.close();
      }
    },
    30000,
  );

  it('guards manual pending work on input, parameters, Cancel and unmount', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.goto(`${harness.url}?tool=json-formatter&manual=1&deferred=1`);
      await page.getByLabel('Input text').fill('{}');
      await page.getByRole('button', { name: /^Run / }).click();
      await page.getByLabel('Input text').fill(' ');
      await page.evaluate(() =>
        (
          window as unknown as { textFixture: { release(index: number, outcome: string): void } }
        ).textFixture.release(0, 'error'),
      );
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Download', exact: true }).count()).toBe(0);
      await page.getByLabel('Input text').fill('{}');
      await page.getByRole('button', { name: /^Run / }).click();
      await page.getByLabel('Sort object keys').check();
      await page.evaluate(() =>
        (
          window as unknown as { textFixture: { release(index: number, outcome: string): void } }
        ).textFixture.release(1, 'success'),
      );
      await page.waitForTimeout(50);
      expect(await page.getByRole('button', { name: 'Download', exact: true }).count()).toBe(0);
      await page.getByRole('button', { name: /^Run / }).click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.evaluate(() =>
        (
          window as unknown as { textFixture: { release(index: number, outcome: string): void } }
        ).textFixture.release(2, 'success'),
      );
      await page.waitForTimeout(50);
      expect(await page.getByRole('button', { name: 'Download', exact: true }).count()).toBe(0);
      await page.getByRole('button', { name: /^Run / }).click();
      await page.getByRole('button', { name: 'Unmount runner' }).click();
      await page.evaluate(() =>
        (
          window as unknown as { textFixture: { release(index: number, outcome: string): void } }
        ).textFixture.release(3, 'error'),
      );
      await page.waitForTimeout(50);
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(
        await page.evaluate(() =>
          (
            window as unknown as { textFixture: { pending: { ctx: { signal: AbortSignal } }[] } }
          ).textFixture.pending.every((item) => item.ctx.signal.aborted),
        ),
      ).toBe(true);
    } finally {
      await page.close();
    }
  }, 30000);

  it('reports manual copy denial and revokes only its owned download URLs after use or unmount', async () => {
    const page = await harness.browser.newPage();
    try {
      await page.addInitScript(() => {
        const create = URL.createObjectURL.bind(URL);
        const revoke = URL.revokeObjectURL.bind(URL);
        const urls: string[] = [];
        const revoked: string[] = [];
        Object.assign(window, { liveUrlProbe: { urls, revoked } });
        URL.createObjectURL = (blob) => {
          const url = create(blob);
          urls.push(url);
          return url;
        };
        URL.revokeObjectURL = (url) => {
          revoked.push(url);
          revoke(url);
        };
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: () => Promise.reject(new Error('denied')) },
        });
      });
      await page.goto(`${harness.url}?tool=remove-duplicate-lines-online&manual=1`);
      await page.getByRole('button', { name: /^Run / }).click();
      await page.getByRole('button', { name: 'Copy', exact: true }).click();
      await page
        .getByRole('alert')
        .getByText('Copy unavailable. Use Download.', { exact: true })
        .waitFor();
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await event;
      await page.waitForTimeout(1100);
      const second = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await second;
      await page.getByRole('button', { name: 'Unmount runner' }).click();
      const probe = await page.evaluate(
        () =>
          (window as unknown as { liveUrlProbe: { urls: string[]; revoked: string[] } })
            .liveUrlProbe,
      );
      expect(probe.urls).toHaveLength(2);
      expect(new Set(probe.revoked)).toEqual(new Set(probe.urls));
    } finally {
      await page.close();
    }
  }, 30000);
});
