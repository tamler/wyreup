import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';
let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => {
  harness = await openBrowserHarness('./test/fixtures/ManualTextHarness.svelte');
}, 30000);
afterAll(async () => {
  await harness?.close();
});
it('rejects metadata-over-limit preload without calling File.text', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url + '/?id=remove-duplicate-lines-online&preload=oversize');
    await page.waitForTimeout(50);
    expect(
      await page.evaluate(
        () => (window as unknown as { manualTextProbe: { reads: number } }).manualTextProbe.reads,
      ),
    ).toBe(0);
    expect(await page.getByLabel('Input text').inputValue()).toBe('');
    expect(await page.getByRole('alert').textContent()).toContain('size limit');
  } finally {
    await page.close();
  }
}, 30000);
