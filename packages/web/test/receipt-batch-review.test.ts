import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';

let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
beforeAll(async () => { harness = await openBrowserHarness('./test/fixtures/ReceiptBatchReviewHarness.svelte'); }, 30000);
afterAll(async () => { await harness?.close(); });

it('edits reviewed fields locally and exports a revalidated formula-safe CSV', async () => {
  const page = await harness.browser.newPage();
  const requests: string[] = [];
  page.on('request', request => { if (!request.url().startsWith(harness.url) || request.method() !== 'GET') requests.push(request.url()); });
  try {
    await page.goto(harness.url);
    await page.getByLabel('Receipt 1 merchant').fill('＝1+1');
    await page.getByLabel('Receipt 1 total').fill('=2+2');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    expect(await page.getByRole('alert').textContent()).toContain('Receipt 1 total: Invalid decimal');
    const invalid = page.getByLabel('Receipt 1 total');
    expect(await invalid.getAttribute('aria-invalid')).toBe('true');
    const describedBy = (await invalid.getAttribute('aria-describedby'))?.split(' ') ?? [];
    expect(describedBy).toContain(await page.getByRole('alert').getAttribute('id'));
    expect(await invalid.evaluate(element => document.activeElement === element)).toBe(true);
    expect(await invalid.getAttribute('inputmode')).toBeNull();
    expect(await page.getByRole('alert').textContent()).toContain('period');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    expect(await page.getByRole('alert').textContent()).toContain('Receipt 1 total: Invalid decimal');
    expect(await invalid.evaluate(element => document.activeElement === element)).toBe(true);
    await page.getByLabel('Receipt 1 total').fill('-3.25');
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    const download = await event;
    const path = await download.path();
    if (!path) throw new Error('No CSV download');
    const csv = await readFile(path, 'utf8');
    expect(csv).toContain('"\'＝1+1"');
    expect(csv).toContain(',-3.25,');
    expect(await page.getByText('Model-reported evidence (unverified)').count()).toBe(1);
    expect(requests).toEqual([]);
  } finally { await page.close(); }
}, 30000);

it('identifies and focuses an invalid line field', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    const amount = page.getByLabel('Receipt 1 line 1 amount');
    await amount.fill('invalid');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    expect(await page.getByRole('alert').textContent()).toContain('Receipt 1 line 1 amount: Invalid decimal');
    expect(await amount.getAttribute('aria-invalid')).toBe('true');
    expect(await amount.getAttribute('aria-describedby')).toBeTruthy();
    expect(await amount.getAttribute('inputmode')).toBeNull();
    expect(await amount.evaluate(element => document.activeElement === element)).toBe(true);
  } finally { await page.close(); }
}, 30000);

it('adds and removes lines, enforcing the 20-line maximum', async () => {
  const page = await harness.browser.newPage();
  page.setDefaultTimeout(3000);
  try {
    await page.goto(harness.url);
    await page.getByRole('button', { name: 'Remove receipt 1 line 1' }).click();
    expect(await page.getByLabel('Receipt 1 line 1 description').count()).toBe(0);
    expect(await page.getByRole('status').textContent()).toContain('removed');
    expect(await page.getByRole('button', { name: 'Undo line removal' }).evaluate(element => document.activeElement === element)).toBe(true);
    await page.getByRole('button', { name: 'Undo line removal' }).click();
    expect(await page.getByLabel('Receipt 1 line 1 description').inputValue()).toBe('Item');
    await page.getByRole('button', { name: 'Remove receipt 1 line 1' }).click();
    await page.getByRole('button', { name: 'Keep line removal' }).click();
    expect(await page.getByRole('button', { name: 'Add line to receipt 1' }).evaluate(element => document.activeElement === element)).toBe(true);
    await page.getByRole('button', { name: 'Add line to receipt 1' }).click();
    expect(await page.getByLabel('Receipt 1 line 1 description').evaluate(element => document.activeElement === element)).toBe(true);
    for (let i = 1; i < 20; i++) await page.getByRole('button', { name: 'Add line to receipt 1' }).click();
    expect(await page.getByLabel('Receipt 1 line 20 amount').count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Add line to receipt 1' }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Remove receipt 1 line 20' }).click();
    expect(await page.getByRole('button', { name: 'Add line to receipt 1' }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Undo line removal' }).click();
    expect(await page.getByLabel('Receipt 1 line 20 amount').count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Add line to receipt 1' }).isDisabled()).toBe(true);
    await page.getByRole('button', { name: 'Remove receipt 1 line 20' }).click();
    await page.getByRole('button', { name: 'Keep line removal' }).click();
    expect(await page.getByRole('button', { name: 'Add line to receipt 1' }).isEnabled()).toBe(true);
  } finally { await page.close(); }
}, 30000);

it('rejects a blank added line instead of exporting it', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    await page.getByRole('button', { name: 'Add line to receipt 1' }).click();
    await page.getByRole('button', { name: 'Download CSV' }).click();
    expect(await page.getByRole('alert').textContent()).toContain('Receipt 1 line 2 description: Enter a description, quantity or amount');
    const input = page.getByLabel('Receipt 1 line 2 description');
    expect(await input.getAttribute('aria-invalid')).toBe('true');
    expect(await input.evaluate(element => document.activeElement === element)).toBe(true);
  } finally { await page.close(); }
}, 30000);

it('loads a blank model line for correction and clears its error when quantity is entered', async () => {
  const page = await harness.browser.newPage();
  page.setDefaultTimeout(3000);
  try {
    await page.goto(`${harness.url}/?blank=1`);
    const description = page.getByLabel('Receipt 1 line 1 description');
    expect(await description.count()).toBe(1);
    await page.getByRole('button', { name: 'Download CSV' }).click();
    expect(await description.getAttribute('aria-invalid')).toBe('true');
    await page.getByLabel('Receipt 1 line 1 quantity').fill('2');
    expect(await description.getAttribute('aria-invalid')).toBeNull();
    expect(await page.getByRole('alert').count()).toBe(0);
  } finally { await page.close(); }
}, 30000);

it('requires resolving a line removal before export and retains validation after undo', async () => {
  const page = await harness.browser.newPage();
  page.setDefaultTimeout(3000);
  try {
    await page.goto(`${harness.url}/?two=1`);
    await page.getByLabel('Receipt 1 line 2 amount').fill('bad');
    await page.getByRole('button', { name: 'Remove receipt 1 line 1' }).click();
    await page.getByRole('button', { name: 'Download CSV' }).click();
    expect(await page.getByRole('alert').textContent()).toContain('Undo or keep the line removal before exporting');
    await page.getByRole('button', { name: 'Undo line removal' }).click();
    expect(await page.getByLabel('Receipt 1 line 2 amount').inputValue()).toBe('bad');
    expect(await page.getByLabel('Receipt 1 line 1 amount').getAttribute('aria-invalid')).toBeNull();
    await page.getByRole('button', { name: 'Download CSV' }).click();
    expect(await page.getByRole('alert').textContent()).toContain('Receipt 1 line 2 amount: Invalid decimal');
    expect(await page.getByLabel('Receipt 1 line 2 amount').getAttribute('aria-invalid')).toBe('true');
  } finally { await page.close(); }
}, 30000);
