import { expect, it } from 'vitest';
import { openBrowserHarness } from './browserHarness';
import { onRequestGet as checkoutPage } from '../../../functions/checkout';
import { TRANSACTION_ID, paddleFixture } from '../../../functions/_lib/test/paddle';

it('waits for the exact purchase to settle and opens payment in a separate tab', async () => {
  const harness = await openBrowserHarness('./src/components/BuyCreditsSheet.svelte');
  try {
    const context = await harness.browser.newContext();
    const page = await context.newPage();
    const id = `txn_${'x'.repeat(26)}`;
    let statusRequests = 0;
    let settled = false;
    const attemptedVendors: string[] = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== harness.url) {
        attemptedVendors.push(url.hostname);
        await route.abort();
        return;
      }
      if (url.pathname === '/api/credits/checkout') {
        await route.fulfill({ json: { checkoutUrl: `${harness.url}/checkout?_ptxn=${id}`, transactionId: id } });
      } else if (url.pathname === '/api/account/balance') {
        await route.fulfill({ json: { balance: 9999 } });
      } else if (url.pathname === '/api/credits/status') {
        expect(url.searchParams.get('transactionId')).toBe(id);
        statusRequests++;
        await route.fulfill({ json: { state: settled ? 'fulfilled' : 'open' } });
      } else if (url.pathname === '/checkout') {
        await route.fulfill({ contentType: 'text/html', body: '<title>Synthetic checkout</title><h1>Synthetic checkout</h1>' });
      } else {
        await route.continue();
      }
    });
    await page.goto(harness.url);
    await page.getByRole('button', { name: /220 credits/ }).click();
    const link = page.getByRole('link', { name: 'Continue to Paddle checkout' });
    await link.waitFor({ timeout: 2500 });
    const opened = context.waitForEvent('page');
    await link.click();
    const checkout = await opened;
    await checkout.waitForURL(`**/checkout?_ptxn=${id}`);
    expect(await checkout.evaluate(() => window.opener === null)).toBe(true);
    await expect.poll(() => statusRequests, { timeout: 5000 }).toBeGreaterThan(0);
    expect(await page.getByRole('dialog').getByText('Waiting for payment confirmation…').isVisible()).toBe(true);
    settled = true;
    await expect.poll(() => statusRequests, { timeout: 5000 }).toBeGreaterThan(1);
    await expect.poll(() => page.getByRole('dialog').getByText('Waiting for payment confirmation…').isVisible()).toBe(false);
    expect(attemptedVendors).toEqual([]);
  } finally {
    await harness.close();
  }
}, 15_000);

it('executes the dedicated payment page with only the sandbox SDK, frame and public token', async () => {
  const harness = await openBrowserHarness('./src/components/BuyCreditsSheet.svelte');
  try {
    const fixture = await paddleFixture(harness.url);
    try {
      await fixture.enableSandbox();
      const context = await harness.browser.newContext();
      const page = await context.newPage();
      const requested: string[] = [];
      const violations: string[] = [];
      page.on('console', entry => {
        if (entry.type() === 'error' && entry.text().includes('Content Security Policy')) violations.push(entry.text());
      });
      await context.route('**/*', async route => {
        const url = route.request().url();
        requested.push(url);
        if (url.startsWith(harness.url + '/checkout?')) {
          const path = new URL(url);
          const result = await checkoutPage(await fixture.context(path.pathname + path.search));
          const body = await result.text();
          expect(body).not.toContain(fixture.env.PADDLE_API_KEY);
          expect(body).not.toContain(fixture.env.PADDLE_WEBHOOK_SECRET);
          await route.fulfill({
            status: result.status, headers: Object.fromEntries(result.headers.entries()), body,
          });
        } else if (url === 'https://cdn.paddle.com/paddle/v2/paddle.js') {
          await route.fulfill({ contentType: 'application/javascript', body: `
            window.Paddle = {
              Environment: { set(mode) { document.body.dataset.mode = mode; } },
              Initialize(options) {
                document.body.dataset.token = options.token;
                document.body.dataset.logout = String(options.checkout.settings.allowLogout);
                if (new URL(location.href).searchParams.has('_ptxn')) {
                  const frame = document.createElement('iframe');
                  frame.src = 'https://sandbox-buy.paddle.com/test';
                  document.body.appendChild(frame);
                }
              },
            };
          ` });
        } else if (url === 'https://sandbox-buy.paddle.com/test') {
          await route.fulfill({ contentType: 'text/html', body: '<p>Sandbox payment test frame</p>' });
        } else {
          await route.abort();
        }
      });
      const path = `/checkout?_ptxn=${TRANSACTION_ID}`;
      await page.goto(harness.url + path);
      await page.getByRole('status').getByText('Payment is handled by Paddle.').waitFor();
      expect(await page.locator('body').getAttribute('data-mode')).toBe('sandbox');
      expect(await page.locator('body').getAttribute('data-token')).toBe('test_synthetic');
      expect(await page.locator('body').getAttribute('data-logout')).toBe('false');
      await page.frameLocator('iframe').getByText('Sandbox payment test frame').waitFor();
      expect(requested).toEqual([harness.url + path, 'https://cdn.paddle.com/paddle/v2/paddle.js', 'https://sandbox-buy.paddle.com/test']);
      expect(violations).toEqual([]);
    } finally {
      await fixture.close();
    }
  } finally {
    await harness.close();
  }
}, 15_000);
