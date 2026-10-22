import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { openBrowserHarness } from './browserHarness';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => {
  harness = await openBrowserHarness('./test/fixtures/GradientHarness.svelte');
}, 30000);
afterAll(async () => {
  await harness?.close();
});
async function visit(query = '', narrow = false) {
  const page = await harness.browser.newPage(
    narrow ? { viewport: { width: 375, height: 812 } } : {},
  );
  page.setDefaultTimeout(5000);
  await page.goto(harness.url + query);
  return page;
}
async function artifact(page: Page, json = false) {
  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: json ? 'Download JSON' : 'Download CSS value', exact: true })
    .click();
  const download = await pending,
    path = await download.path();
  if (!path) throw new Error('Full gradient artifact missing.');
  expect(download.suggestedFilename()).toBe(json ? 'gradient.json' : 'gradient.css');
  return readFile(path, 'utf8');
}
async function generate(page: Page) {
  await page.getByRole('button', { name: 'Generate gradient', exact: true }).click();
  await page.getByRole('img').waitFor();
}

it('actual advanced CSS alpha survives angle/stop changes and opaque picker synchronization', async () => {
  const page = await visit();
  const requests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(harness.url)) requests.push(request.url());
  });
  try {
    expect(await page.locator('input[type=file]').count()).toBe(0);
    await page.getByLabel('First color', { exact: true }).fill('color(srgb 1 0 0 / 0.5)');
    await page.getByLabel('Second color', { exact: true }).fill('rgba(0, 0, 255, 0.25)');
    await page.getByLabel('Angle (degrees)', { exact: true }).fill('210');
    await page.getByLabel('First stop (%)', { exact: true }).fill('10');
    await page.getByLabel('Second stop (%)', { exact: true }).fill('90');
    await generate(page);
    const css = 'linear-gradient(210deg, rgba(255, 0, 0, 0.5) 10%, rgba(0, 0, 255, 0.25) 90%)';
    expect(await page.locator('pre').textContent()).toBe(css);
    expect(await page.getByRole('img').getAttribute('style')).toContain(css);
    expect(await artifact(page)).toBe(css);
    expect(await artifact(page, true)).toBe(JSON.stringify({ css }));
    expect(await page.getByLabel('First opaque sRGB picker', { exact: true }).inputValue()).toBe(
      '#ff0000',
    );
    expect(await page.getByLabel('Second opaque sRGB picker', { exact: true }).inputValue()).toBe(
      '#0000ff',
    );
    expect(await page.getByLabel('First color', { exact: true }).inputValue()).toBe(
      'color(srgb 1 0 0 / 0.5)',
    );
    await page.getByLabel('Angle (degrees)', { exact: true }).fill('30');
    expect(await page.getByRole('img').count()).toBe(0);
    await generate(page);
    expect(await page.locator('pre').textContent()).toBe(css.replace('210deg', '30deg'));
    expect(await page.getByLabel('Second color', { exact: true }).inputValue()).toBe(
      'rgba(0, 0, 255, 0.25)',
    );
    expect(requests).toEqual([]);
    await page.screenshot({ path: '/private/tmp/wyreup-catalog-evidence/gradient-desktop.png' });
  } finally {
    await page.close();
  }
}, 30000);

it('explicit picker edit replaces only one color, preserves other alpha, supports mobile and copy failure', async () => {
  const page = await visit('', true);
  try {
    await page.getByLabel('First color', { exact: true }).fill('rgba(255, 0, 0, 0.5)');
    await page.getByLabel('Second color', { exact: true }).fill('rgba(0, 0, 255, 0.25)');
    await generate(page);
    await page.getByLabel('First opaque sRGB picker', { exact: true }).fill('#008000');
    expect(await page.getByLabel('First color', { exact: true }).inputValue()).toBe('#008000');
    expect(await page.getByLabel('Second color', { exact: true }).inputValue()).toBe(
      'rgba(0, 0, 255, 0.25)',
    );
    expect(await page.getByRole('status').textContent()).toContain('First picker edit replaces');
    expect(await page.getByRole('img').count()).toBe(0);
    await generate(page);
    expect(await artifact(page)).toBe(
      'linear-gradient(90deg, rgba(0, 128, 0, 1) 0%, rgba(0, 0, 255, 0.25) 100%)',
    );
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('Controlled clipboard unavailable')) },
      }),
    );
    await page.getByRole('button', { name: 'Copy CSS value' }).click();
    expect(await page.getByRole('status').textContent()).toContain(
      'Copy unavailable. Use Download CSS value.',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: '/private/tmp/wyreup-catalog-evidence/gradient-mobile.png' });
  } finally {
    await page.close();
  }
}, 30000);

it('actual gamut/stop/color errors clear stale output and never execute resource syntax', async () => {
  const page = await visit();
  const requests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(harness.url)) requests.push(request.url());
  });
  try {
    await generate(page);
    await page.getByLabel('First color', { exact: true }).fill('color(display-p3 1 0 0)');
    await page.getByRole('button', { name: 'Generate gradient', exact: true }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').textContent()).toContain('inside the RGB gamut');
    expect(await page.getByLabel('First color', { exact: true }).inputValue()).toBe(
      'color(display-p3 1 0 0)',
    );
    expect(await page.getByRole('img').count()).toBe(0);
    await page.getByLabel('First color', { exact: true }).fill('url(https://example.com/spy.png)');
    await page.getByRole('button', { name: 'Generate gradient', exact: true }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').textContent()).toContain('supported CSS color');
    await page.getByLabel('First color', { exact: true }).fill('#ff0000');
    await page.getByLabel('First stop (%)', { exact: true }).fill('90');
    await page.getByLabel('Second stop (%)', { exact: true }).fill('10');
    await page.getByRole('button', { name: 'Generate gradient', exact: true }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').textContent()).toContain('First stop cannot');
    await page.getByLabel('Angle (degrees)', { exact: true }).fill('361');
    expect(
      await page.getByRole('button', { name: 'Generate gradient', exact: true }).isDisabled(),
    ).toBe(true);
    expect(await page.locator('pre').count()).toBe(0);
    expect(requests).toEqual([]);
    await page.getByRole('button', { name: 'Clear and reset' }).click();
    expect(await page.getByLabel('First color', { exact: true }).inputValue()).toBe('#ff0000');
    expect(await page.getByLabel('Angle (degrees)', { exact: true }).inputValue()).toBe('90');
  } finally {
    await page.close();
  }
}, 30000);

it('actual delayed generation cancel/edit/clear/unmount and clipboard completion cannot revive stale output', async () => {
  const page = await visit('/?delay=1&error=1');
  try {
    await page.getByRole('button', { name: 'Generate gradient', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(550);
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(await page.getByRole('img').count()).toBe(0);
    await page.goto(harness.url + '/?delay=1');
    await page.getByRole('button', { name: 'Generate gradient', exact: true }).click();
    await page.getByLabel('Angle (degrees)', { exact: true }).fill('180');
    await page.waitForTimeout(550);
    expect(await page.getByRole('img').count()).toBe(0);
    await generate(page);
    await page.evaluate(() => {
      const created: string[] = [],
        revoked: string[] = [];
      const create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL);
      Object.assign(window, { gradientUrls: { created, revoked } });
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        created.push(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        revoked.push(url);
        revoke(url);
      };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () =>
            new Promise<void>((resolve) => {
              Object.assign(window, { resolveGradientClipboard: resolve });
            }),
        },
      });
    });
    await page.getByRole('button', { name: 'Copy CSS value' }).click();
    await artifact(page);
    await artifact(page, true);
    await page.getByRole('button', { name: 'Clear and reset' }).click();
    await page.evaluate(() =>
      (window as unknown as { resolveGradientClipboard: () => void }).resolveGradientClipboard(),
    );
    expect(await page.getByRole('status').filter({ hasText: 'Copied' }).count()).toBe(0);
    const urls = await page.evaluate(
      () =>
        (window as unknown as { gradientUrls: { created: string[]; revoked: string[] } })
          .gradientUrls,
    );
    expect(urls.created).toHaveLength(2);
    expect(urls.revoked).toEqual(urls.created);
    await page.getByRole('button', { name: 'Generate gradient', exact: true }).click();
    await page.getByRole('button', { name: 'Clear and reset' }).click();
    await page.waitForTimeout(550);
    expect(await page.getByRole('img').count()).toBe(0);
    await page.getByRole('button', { name: 'Generate gradient', exact: true }).click();
    await page.getByRole('button', { name: 'Unmount gradient runner' }).click();
    await page.waitForTimeout(550);
    expect(await page.getByRole('img').count()).toBe(0);
    expect(await page.getByRole('alert').count()).toBe(0);
  } finally {
    await page.close();
  }
}, 30000);
