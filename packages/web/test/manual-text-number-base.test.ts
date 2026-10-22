import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';
let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => {
  harness = await openBrowserHarness('./test/fixtures/ManualTextHarness.svelte');
}, 30000);
afterAll(async () => {
  await harness?.close();
});
it.each([
  ['10', '42', '42', '2A', 'Decimal (base 10)'],
  ['16', '10', '16', '10', 'Hexadecimal (base 16)'],
  ['16', '+0x10', '16', '10', 'Hexadecimal (base 16)'],
  ['2', '+0b10', '2', '2', 'Binary (base 2)'],
  ['8', '+0o10', '8', '8', 'Octal (base 8)'],
])(
  'numeric enum base %s interprets %s through the actual typed engine',
  async (_inputBase, input, expectedDecimal, expectedHexadecimal, inputBaseLabel) => {
    const page = await harness.browser.newPage();
    page.setDefaultTimeout(5000);
    try {
      await page.goto(harness.url + '/?id=number-base-converter');
      await page.getByLabel('Input base', { exact: true }).selectOption({ label: inputBaseLabel });
      await page.getByLabel('Input text').fill(input);
      await page.getByRole('button', { name: /^Run / }).click();
      await page.locator('.error-panel, .result-panel').waitFor();
      expect(await page.getByRole('alert').count(), await page.locator('body').innerText()).toBe(0);
      await page.getByRole('button', { name: 'Download', exact: true }).waitFor();
      const decimal = page
        .locator('dl[aria-label="Result summary"] .readable-json__item')
        .filter({ has: page.getByText('Decimal', { exact: true }) })
        .locator('dd');
      expect(await decimal.count()).toBe(1);
      expect(await decimal.textContent()).toBe(expectedDecimal);
      await page.getByRole('button', { name: 'Raw JSON', exact: true }).click();
      const raw = await page
        .getByRole('region', { name: 'Raw JSON result', exact: true })
        .textContent();
      expect(typeof raw).toBe('string');
      const decoded: unknown = JSON.parse(raw!);
      expect(decoded).toMatchObject({
        decimal: expectedDecimal,
        hexadecimal: expectedHexadecimal,
      });
    } finally {
      await page.close();
    }
  },
  30000,
);
