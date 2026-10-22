import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => {
  harness = await openBrowserHarness('./test/fixtures/ManualTextHarness.svelte');
}, 30000);
afterAll(async () => {
  await harness?.close();
});
async function visit(id: string, suffix = '', narrow = false) {
  const page = await harness.browser.newPage(
    narrow ? { viewport: { width: 375, height: 812 } } : {},
  );
  page.setDefaultTimeout(5000);
  await page.goto(`${harness.url}/?id=${id}${suffix}`);
  return page;
}
async function run(page: Page) {
  await page.getByRole('button', { name: /^Run / }).click();
  await page.locator('.error-panel, .result-panel').waitFor();
  expect(await page.getByRole('alert').count(), await page.locator('body').innerText()).toBe(0);
  await page.getByRole('button', { name: 'Download', exact: true }).waitFor();
}
async function download(page: Page) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const path = await (await event).path();
  if (!path) throw new Error('Complete manual output missing.');
  return readFile(path, 'utf8');
}

const beautifierOracles = [
  ['javascript', 'const x={a:1}', 'const x = { a: 1 };\n'],
  ['json', '{"b":1,"a":2}', '{\n  "b": 1,\n  "a": 2\n}'],
  ['css', 'a{color:red}', 'a {\n  color: red;\n}\n'],
  ['html', '<div><span>Hello</span></div>', '<div><span>Hello</span></div>\n'],
  ['xml', '<root><item>1</item></root>', '<root>\n  <item>1</item>\n</root>\n'],
  ['sql', 'select a from users where x=1', 'SELECT\n  a\nFROM\n  users\nWHERE\n  x = 1'],
] as const;
it.each(beautifierOracles)(
  'actual %s beautifier selection produces its fixed output and full text artifact',
  async (language, input, expected) => {
    const page = await visit('code-beautifier');
    try {
      await page.getByLabel('Language', { exact: true }).selectOption({ label: language });
      await page.getByLabel('Input text').fill(input);
      await run(page);
      expect(
        await page.getByRole('region', { name: 'Text result', exact: true }).textContent(),
      ).toBe(expected);
      expect(await download(page)).toBe(expected);
      expect(await page.getByRole('alert').count()).toBe(0);
    } finally {
      await page.close();
    }
  },
  30000,
);

it('actual HTML beautifier remains literal text/plain even for active-looking markup', async () => {
  const page = await visit('code-beautifier');
  const requests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(harness.url)) requests.push(request.url());
  });
  try {
    await page.getByLabel('Language', { exact: true }).selectOption({ label: 'html' });
    await page
      .getByLabel('Input text')
      .fill(
        '<img src="https://example.com/spy.png" onerror="window.executed=true"><script>window.executed=true</script>',
      );
    await run(page);
    const text = await page.getByRole('region', { name: 'Text result', exact: true }).textContent();
    expect(text).toBe(
      '<img src="https://example.com/spy.png" onerror="window.executed = true" />\n<script>\n  window.executed = true;\n</script>\n',
    );
    expect(await download(page)).toBe(text);
    expect(await page.locator('.runner img, .runner script').count()).toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { executed?: boolean }).executed),
    ).toBeUndefined();
    expect(requests).toEqual([]);
    await page.getByLabel('Language', { exact: true }).selectOption({ label: 'json' });
    await page.getByLabel('Input text').fill('{invalid');
    await page.getByRole('button', { name: /^Run / }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('button', { name: 'Download', exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 30000);

it('real Terser minifier preserves ASI/identifiers, reports parse errors and retains zero-byte outputs', async () => {
  const page = await visit('javascript-minifier');
  try {
    for (const [input, expected] of [
      ['function f(){return\n{x:1}}', 'function f(){return;{x:1}}'],
      [
        'function descriptiveIdentifier(inputValue) { return inputValue + 1; }',
        'function descriptiveIdentifier(inputValue){return inputValue+1}',
      ],
    ]) {
      await page.getByLabel('Input text').fill(input);
      await run(page);
      expect(await download(page)).toBe(expected);
    }
    await page.getByLabel('Input text').fill('const =');
    await page.getByRole('button', { name: /^Run / }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('button', { name: 'Download', exact: true }).count()).toBe(0);
    await page.getByLabel('Input text').fill(' ');
    await run(page);
    expect(await page.getByText('0 output bytes — Empty output.', { exact: true }).count()).toBe(1);
    expect(await download(page)).toBe('');
  } finally {
    await page.close();
  }
}, 30000);

it('actual UTF8 byte modes preserve whitespace and Unicode, reject bad bytes before any replacement', async () => {
  const page = await visit('number-base-converter');
  try {
    await page.getByLabel('Conversion', { exact: true }).selectOption({ label: 'UTF-8 bytes (plain text)' });
    await page.getByLabel('Input text').fill(' ');
    await run(page);
    expect(await download(page)).toBe('00100000');
    await page.getByLabel('Byte format', { exact: true }).selectOption({ label: 'Hexadecimal pairs' });
    await run(page);
    expect(await download(page)).toBe('20');
    await page.getByLabel('Byte format', { exact: true }).selectOption({ label: 'Decimal bytes' });
    await page.getByLabel('Input text').fill('é\n');
    await run(page);
    expect(await download(page)).toBe('195 169 10');
    await page.getByLabel('Direction', { exact: true }).selectOption({ label: 'Bytes to text' });
    await page.getByLabel('Byte format', { exact: true }).selectOption({ label: '8-bit binary groups' });
    await page.getByLabel('Input text').fill('11000011 10101001');
    await run(page);
    expect(await download(page)).toBe('é');
    await page.getByLabel('Byte format', { exact: true }).selectOption({ label: 'Hexadecimal pairs' });
    await page.getByLabel('Input text').fill('C3 A9');
    await run(page);
    expect(await download(page)).toBe('é');
    await page.getByLabel('Input text').fill('c3');
    await page.getByRole('button', { name: /^Run / }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').textContent()).toContain('Invalid UTF-8');
    await page.getByLabel('Direction', { exact: true }).selectOption({ label: 'Text to bytes' });
    await page.evaluate(() => {
      const input = document.querySelector('textarea')!;
      input.value = '\uD800';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.getByRole('button', { name: /^Run / }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').textContent()).toContain('surrogate');
    await page.getByLabel('Input text').fill('');
    await run(page);
    expect(await download(page)).toBe('');
  } finally {
    await page.close();
  }
}, 30000);

it('actual duplicate tool runs empty and whitespace inputs with literal full artifacts', async () => {
  const page = await visit('remove-duplicate-lines-online');
  try {
    await run(page);
    expect(await download(page)).toBe('');
    expect(await page.getByRole('button', { name: 'Copy', exact: true }).count()).toBe(1);
    await page.getByLabel('Input text').fill('  ');
    await run(page);
    expect(await download(page)).toBe('  ');
    await page.getByLabel('Trim each retained line', { exact: true }).check();
    await run(page);
    expect(await download(page)).toBe('');
  } finally {
    await page.close();
  }
}, 30000);

it('safe Markdown table preview uses literal cells and DOM br while full escaped artifact survives', async () => {
  const page = await visit('markdown-table-generator', '', true);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(harness.url)) requests.push(request.url());
  });
  try {
    await page.getByLabel('Input text').fill('name,note\nA,"a|b\\c\n<script>""x""</script>"\n');
    await run(page);
    const expected =
      '| name | note |\n| --- | --- |\n| A | a\\|b\\\\c<br>&lt;script&gt;&quot;x&quot;&lt;/script&gt; |\n';
    expect(await download(page)).toBe(expected);
    expect(await page.getByRole('region', { name: 'Text result', exact: true }).textContent()).toBe(
      expected,
    );
    const preview = page.getByRole('region', { name: 'Safe Markdown table preview', exact: true });
    expect(await preview.locator('td').nth(1).innerText()).toBe('a|b\\c\n<script>"x"</script>');
    expect(await preview.locator('td br').count()).toBe(1);
    expect(await preview.locator('img, script, iframe').count()).toBe(0);
    expect(requests).toEqual([]);
    await page.getByLabel('First row is a header', { exact: true }).uncheck();
    await run(page);
    expect(await preview.locator('th').allTextContents()).toEqual(['Column 1', 'Column 2']);
    expect(await preview.locator('tbody tr').count()).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await page.close();
  }
}, 30000);

it('Markdown pagination never truncates the full artifact and shared-parser errors invalidate the preview', async () => {
  const page = await visit('markdown-table-generator');
  try {
    const source =
      'name,value\n' + Array.from({ length: 53 }, (_, i) => `row${i},${i}`).join('\n') + '\n';
    await page.getByLabel('Input text').fill(source);
    await run(page);
    const preview = page.getByRole('region', { name: 'Safe Markdown table preview', exact: true });
    expect(await preview.locator('tbody tr').count()).toBe(25);
    const complete = await download(page);
    expect(complete).toContain('| row52 | 52 |\n');
    await page.getByRole('button', { name: 'Next table page', exact: true }).click();
    expect(await preview.locator('td').first().textContent()).toBe('row25');
    expect(await download(page)).toBe(complete);
    await page.getByLabel('Input text').fill('a,b\n"unterminated');
    await page.getByRole('button', { name: /^Run / }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').textContent()).toContain('CSV parse');
    expect(await preview.count()).toBe(0);
    await page.getByLabel('Input delimiter', { exact: true }).selectOption({ label: 'auto' });
    await page.getByLabel('Input text').fill('a,b\tc\nd,e\tf\n');
    await page.getByRole('button', { name: /^Run / }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('alert').textContent()).toContain('ambiguous');
  } finally {
    await page.close();
  }
}, 30000);

it('preload/input/parameter/cancel/unmount guards hold for actual delayed manual results', async () => {
  const page = await visit('remove-duplicate-lines-online', '&preload=delayed');
  try {
    await page.getByLabel('Input text').fill('new');
    await page.evaluate(() =>
      (
        window as unknown as { manualTextProbe: { releasePreload: () => void } }
      ).manualTextProbe.releasePreload(),
    );
    await page.waitForTimeout(30);
    expect(await page.getByLabel('Input text').inputValue()).toBe('new');
    await page.goto(`${harness.url}/?id=markdown-table-generator&deferred=1`);
    await page.getByLabel('Input text').fill('a,b\n1,2');
    await page.getByRole('button', { name: /^Run / }).click();
    await page.waitForFunction(
      () =>
        (window as unknown as { manualTextProbe: { pending: unknown[] } }).manualTextProbe.pending
          .length === 1,
    );
    await page.getByLabel('First row is a header', { exact: true }).uncheck();
    await page.evaluate(() =>
      (
        window as unknown as { manualTextProbe: { pending: { release: () => void }[] } }
      ).manualTextProbe.pending[0].release(),
    );
    await page.waitForTimeout(30);
    expect(await page.locator('table').count()).toBe(0);
    await page.getByRole('button', { name: /^Run / }).click();
    await page.waitForFunction(
      () =>
        (window as unknown as { manualTextProbe: { pending: unknown[] } }).manualTextProbe.pending
          .length === 2,
    );
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() =>
      (
        window as unknown as { manualTextProbe: { pending: { release: () => void }[] } }
      ).manualTextProbe.pending[1].release(),
    );
    await page.waitForTimeout(30);
    expect(await page.locator('table').count()).toBe(0);
    await page.getByRole('button', { name: /^Run / }).click();
    await page.waitForFunction(
      () =>
        (window as unknown as { manualTextProbe: { pending: unknown[] } }).manualTextProbe.pending
          .length === 3,
    );
    await page.getByRole('button', { name: 'Unmount manual text runner' }).click();
    await page.evaluate(() =>
      (
        window as unknown as { manualTextProbe: { pending: { release: () => void }[] } }
      ).manualTextProbe.pending[2].release(),
    );
    await page.waitForTimeout(30);
    expect(await page.locator('table').count()).toBe(0);
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { manualTextProbe: { pending: { ctx: { signal: AbortSignal } }[] } }
        ).manualTextProbe.pending.every((item) => item.ctx.signal.aborted),
      ),
    ).toBe(true);
  } finally {
    await page.close();
  }
}, 30000);
