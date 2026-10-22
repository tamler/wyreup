import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { openBrowserHarness } from './browserHarness';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => {
  harness = await openBrowserHarness('./test/fixtures/GeneratorHarness.svelte');
}, 30000);
afterAll(async () => {
  await harness?.close();
});
async function visit(id: string, query = '', narrow = false) {
  const page = await harness.browser.newPage(
    narrow ? { viewport: { width: 375, height: 812 } } : {},
  );
  page.setDefaultTimeout(5000);
  await page.goto(`${harness.url}/?id=${id}${query}`);
  return page;
}
async function artifact(page: Page, button = 'Download output') {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const saved = await pending;
  const path = await saved.path();
  if (!path) throw new Error('Full generator artifact unavailable.');
  return { text: await readFile(path, 'utf8'), name: saved.suggestedFilename() };
}
async function imported(page: Page, label: string, source: string, mode = 'comma') {
  await page.getByText(`Import or export ${label}`, { exact: true }).click();
  await page.getByLabel(`${label} delimiter`, { exact: true }).selectOption(mode);
  await page.getByLabel(`Paste ${label}`, { exact: true }).fill(source);
  await page.getByRole('button', { name: `Import ${label}`, exact: true }).click();
}

it('actual robots groups and sitemap import produce a full artifact with editable rows and no file picker', async () => {
  const page = await visit('robots-txt-generator', '', true);
  try {
    expect(await page.locator('input[type=file]').count()).toBe(0);
    await imported(
      page,
      'User-agent rules',
      'userAgent,rule,path\n*,Disallow,/private/\n*,Allow,/private/public/\nExampleBot,Disallow,\n',
    );
    await imported(page, 'Sitemap URLs', 'url\nhttps://example.com/sitemap.xml\n');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const expected =
      'User-agent: *\nDisallow: /private/\nAllow: /private/public/\n\nUser-agent: ExampleBot\nDisallow:\n\nSitemap: https://example.com/sitemap.xml\n';
    expect(await page.locator('pre').textContent()).toBe(expected);
    expect(await artifact(page)).toEqual({ name: 'robots.txt', text: expected });
    expect((await artifact(page, 'Export User-agent rules rows')).text).toBe(
      '"userAgent","rule","path"\n"*","Disallow","/private/"\n"*","Allow","/private/public/"\n"ExampleBot","Disallow",""\n',
    );
    await page.getByLabel('Path (empty only for Disallow) 1', { exact: true }).fill('/%0Aevil');
    expect(await page.getByRole('alert').textContent()).toContain('Encoded control');
    expect(await page.getByRole('button', { name: 'Download output' }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Generate', exact: true }).isDisabled()).toBe(
      true,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Clear and reset' }).click();
    expect(
      await page.getByLabel('Path (empty only for Disallow) 1', { exact: true }).inputValue(),
    ).toBe('');
    expect(await page.getByRole('alert').count()).toBe(0);
  } finally {
    await page.close();
  }
}, 30000);

it('actual CSP scalar control excludes raw row JSON and reports clipboard failures', async () => {
  const page = await visit('csp-header-generator');
  try {
    expect(await page.locator('textarea').count()).toBe(1); // only collapsed paste editor
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    expect((await artifact(page)).text).toBe(
      "Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'",
    );
    await page.getByLabel('Report-only header', { exact: true }).check();
    expect(await page.locator('pre').count()).toBe(0);
    await imported(
      page,
      'Directives and sources',
      "directive\tsources\ndefault-src\t'self'\nobject-src\t'none'\n",
      'tab',
    );
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    expect((await artifact(page)).text).toBe(
      "Content-Security-Policy-Report-Only: default-src 'self'; object-src 'none'",
    );
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('Controlled unavailable clipboard')) },
      }),
    );
    await page.getByRole('button', { name: 'Copy output' }).click();
    expect(await page.getByRole('status').textContent()).toContain(
      'Copy unavailable. Use Download output.',
    );
    await page
      .getByLabel('Sources (space-separated tokens) 1', { exact: true })
      .fill("'self'; script-src *");
    expect(await page.getByRole('alert').textContent()).toContain('semicolons');
    expect(await page.locator('pre').count()).toBe(0);
  } finally {
    await page.close();
  }
}, 30000);

it('actual hreflang malicious-looking HTML stays literal and full HTML artifact preserves escaping', async () => {
  const page = await visit('hreflang-tag-generator');
  const requests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(harness.url)) requests.push(request.url());
  });
  try {
    await page.getByLabel('Language tag 1', { exact: true }).fill('en_US');
    await page
      .getByLabel('Alternate URL 1', { exact: true })
      .fill('https://example.com/?q=<script>"&x=1');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const expected =
      '<link rel="alternate" hreflang="en-US" href="https://example.com/?q=&lt;script&gt;&quot;&amp;x=1">\n';
    expect(await page.locator('pre').textContent()).toBe(expected);
    expect(await artifact(page)).toEqual({ name: 'hreflang.html', text: expected });
    expect(await page.locator('link[rel=alternate], img, iframe').count()).toBe(0);
    expect(requests).toEqual([]);
    await imported(
      page,
      'Language and URL rows',
      'language,url\nen_US,https://example.com/\nen-US,https://example.org/\n',
    );
    expect(await page.getByRole('alert').textContent()).toContain('unique canonical');
    expect(await page.locator('pre').count()).toBe(0);
    await page.getByRole('button', { name: 'Discard Language and URL rows paste' }).click();
    expect(await page.getByLabel('Language tag 1', { exact: true }).inputValue()).toBe('en_US');
  } finally {
    await page.close();
  }
}, 30000);

it('nginx full import, numeric status, pagination editing and exports retain every row beyond preview', async () => {
  const page = await visit('nginx-redirect-generator');
  try {
    const rows = Array.from({ length: 300 }, (_, i) => [
      `/old${i}`,
      `/new${i}?q=${'a'.repeat(65)}`,
      308,
    ]);
    await imported(
      page,
      'Redirect rows',
      'source,destination,status\n' + rows.map((row) => row.join(',')).join('\n') + '\n',
    );
    expect(await page.locator('fieldset').count()).toBe(20);
    await page.getByRole('button', { name: 'Next Redirect rows page' }).click();
    await page.getByLabel('Destination 21', { exact: true }).fill('/changed?a=1&b=2');
    expect(await page.getByLabel('Destination 21', { exact: true }).inputValue()).toBe(
      '/changed?a=1&b=2',
    );
    rows[20][1] = '/changed?a=1&b=2';
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const expected = rows
      .map(
        ([source, destination, status]) =>
          `location = ${source} { return ${status} "${destination}"; }\n`,
      )
      .join('');
    expect(expected.length).toBeGreaterThan(20000);
    expect(await page.locator('pre').textContent()).toBe(expected.slice(0, 20000));
    expect((await artifact(page)).text).toBe(expected);
    expect(
      await page
        .getByText(
          'Preview shows the first 20,000 characters. Copy and download retain the complete output.',
        )
        .count(),
    ).toBe(1);
    const csv = (await artifact(page, 'Export Redirect rows rows')).text;
    expect(csv).toContain('"/old299"');
    await page
      .getByLabel('Paste Redirect rows', { exact: true })
      .fill('source,destination,status\n/bad,/new,3e2\n');
    await page.getByRole('button', { name: 'Import Redirect rows', exact: true }).click();
    expect(await page.getByRole('alert').textContent()).toContain('HTTP status');
    expect(await page.locator('pre').count()).toBe(0);
  } finally {
    await page.close();
  }
}, 30000);

it('cancel, clear, stale success/error, and unmount guard actual generator results and owned URLs', async () => {
  const page = await visit('nginx-redirect-generator', '&delay=1&error=1');
  try {
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(550);
    expect(await page.locator('pre').count()).toBe(0);
    expect(await page.getByRole('alert').count()).toBe(0);
    await page.goto(`${harness.url}/?id=nginx-redirect-generator&delay=1`);
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.getByLabel('Destination 1', { exact: true }).fill('/changed');
    await page.waitForTimeout(550);
    expect(await page.locator('pre').count()).toBe(0);
    await page.evaluate(() => {
      const created: string[] = [],
        revoked: string[] = [];
      const create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL);
      Object.assign(window, { generatorUrls: { created, revoked } });
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        created.push(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        revoked.push(url);
        revoke(url);
      };
    });
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.getByRole('button', { name: 'Download output' }).waitFor();
    await artifact(page);
    await page.getByRole('button', { name: 'Clear and reset' }).click();
    const urls = await page.evaluate(
      () =>
        (window as unknown as { generatorUrls: { created: string[]; revoked: string[] } })
          .generatorUrls,
    );
    expect(urls.created).toHaveLength(1);
    expect(urls.revoked).toEqual(urls.created);
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.getByRole('button', { name: 'Clear and reset' }).click();
    await page.waitForTimeout(550);
    expect(await page.locator('pre').count()).toBe(0);
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.getByRole('button', { name: 'Unmount runner' }).click();
    await page.waitForTimeout(550);
    expect(await page.locator('pre').count()).toBe(0);
    expect(await page.getByRole('alert').count()).toBe(0);
  } finally {
    await page.close();
  }
}, 30000);
