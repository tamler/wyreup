import type { Env } from './_lib/env';
import { billingConfig, paddleId } from './_lib/paddle';
import type { PagesFunction } from './_lib/types';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const config = await billingConfig(env, request);
  const transactionId = new URL(request.url).searchParams.get('_ptxn');
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Permissions-Policy': 'interest-cohort=(), browsing-topics=()',
  });
  if (!config || !paddleId(transactionId, 'txn')) {
    headers.set('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    return new Response(
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Checkout unavailable — Wyreup</title><h1>Checkout unavailable</h1><p><a href="/account">Back to your account</a></p></html>',
      { status: config ? 400 : 503, headers },
    );
  }

  const sandbox = config.mode === 'sandbox';
  const prefix = sandbox ? 'sandbox-' : '';
  const nonce = crypto.randomUUID();
  headers.set('Content-Security-Policy', [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://cdn.paddle.com/paddle/v2/`,
    `style-src 'nonce-${nonce}' https://${prefix}cdn.paddle.com https://cdn.paddle.com`,
    `frame-src https://${prefix}buy.paddle.com https://${prefix}checkout.paddle.com`,
    `connect-src https://${prefix}checkout-service.paddle.com`,
    "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'", "form-action 'none'",
  ].join('; '));

  return new Response(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Checkout — Wyreup</title>
<style nonce="${nonce}">
  body { color: #201e1c; font: 1rem/1.5 system-ui, sans-serif; margin: 4rem auto; padding: 0 1.5rem; max-width: 34rem; }
  a { color: inherit; }
</style>
<h1>Wyreup checkout</h1>
<p id="status" role="status">Opening secure checkout…</p>
<p><a href="/account">Back to your account</a></p>
<noscript><p>Enable JavaScript to open checkout.</p></noscript>
<script nonce="${nonce}">
  const status = document.getElementById('status');
  const script = document.createElement('script');
  script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
  script.onerror = () => { status.textContent = 'Payment could not load. Refresh this page to retry.'; };
  script.onload = () => {
    try {
      if (${JSON.stringify(sandbox)}) Paddle.Environment.set('sandbox');
      Paddle.Initialize({
        token: ${JSON.stringify(config.clientToken)},
        checkout: { settings: { allowLogout: false, showAddDiscounts: false,
          successUrl: ${JSON.stringify(`${config.origin}/account`)} } },
        eventCallback: (event) => {
          if (event.name === 'checkout.error') status.textContent = 'Payment could not load. Refresh this page to retry.';
          if (event.name === 'checkout.closed') status.textContent = 'Checkout closed. Refresh this page to reopen it.';
        },
      });
      status.textContent = 'Payment is handled by Paddle.';
    } catch {
      script.onerror();
    }
  };
  document.head.appendChild(script);
</script>
</html>`, { headers });
};
