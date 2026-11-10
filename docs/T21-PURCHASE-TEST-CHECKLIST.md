# T21 — end-to-end purchase test checklist

Written 2026-11-10. **Not executed.** No purchase, test purchase, Lemon Squeezy dashboard action or production write was made while writing it.

T21 is the ROADMAP item "end-to-end purchase test", blocked on Lemon Squeezy approving the store for live sales. Run it only when **all** of these are true:

- [ ] Jacob has confirmed the store is approved for live mode (from the Lemon Squeezy dashboard or LS email — this checklist does not establish it).
- [ ] Jacob has explicitly authorized this run, including the spend (one $5 Starter pack, optionally one $8 monthly subscription) and the refund.
- [ ] The code under test is live: the Deploy workflow on current `main` concluded `success` and `https://wyreup.com/pro/` serves the expected build (see AGENTS.md release gate).

Record every observation with a timestamp in a dated note. Never paste API keys, webhook secrets, session cookies, full card numbers or customer emails into the note.

## What the code does (reference for expected results)

Source: `functions/api/credits/checkout.ts`, `functions/api/webhooks/lemonsqueezy.ts`, `packages/web/src/components/BuyCreditsSheet.svelte`, `functions/api/account/balance.ts`.

| Step | Expected behavior in code |
|---|---|
| Checkout | `POST /api/credits/checkout` with `{pack}` (`starter`/`standard`/`power`/`monthly`), session + CSRF header. Server picks the LS variant from env, sets `custom.userId` server-side, `redirect_url` = `<origin>/account?purchase=success`. Missing variant → 500 `Pack not configured`; missing `LS_API_KEY`/`LS_STORE_ID` → 500 `Payments not configured`; LS error → 502. |
| Overlay | `lemon.js` from `assets.lemonsqueezy.com` opens the overlay (CSP allows that script and `frame-src https://app.lemonsqueezy.com`). If the overlay fails, a new tab opens. The sheet polls `/api/account/balance` up to 5 minutes. |
| Webhook auth | `X-Signature` HMAC-SHA256 of the raw body with `LS_WEBHOOK_SECRET`, constant-time compare. Bad signature → 401. |
| Pack credit | `order_created` with `status: paid`: variant → 220 / 480 / 1000 credits. One `credit_events` row `kind='purchase'`, `ls_order_id = <order id>`. `INSERT OR IGNORE` + unique order id makes redelivery idempotent. Unknown variant → 400. |
| Monthly | `order_created` for the monthly variant is acknowledged without credit. `subscription_payment_success` grants 440 credits (`kind='subscription_grant'`). `subscription_created` stores the subscription id/status. |
| Refund | `order_refunded`: inserts `kind='refund'`, amount = minus the original purchase, `ls_order_id = <order id>:refund`, user taken from the original purchase row (not the payload). No original purchase → 200, no row. |
| Cancel | `subscription_cancelled` / `_expired` / `_paused` update `users.subscription_status`. |

## A. Pre-flight (read-only)

- [ ] `gh run list --branch main --workflow 'Deploy to Cloudflare Pages' --limit 1 --json conclusion,headSha` → `success` on the commit you expect.
- [ ] `curl -sI https://wyreup.com/pricing` → `301`, `location: /pro/#pricing` (only after the /pricing PR is merged and deployed).
- [ ] `curl -s https://wyreup.com/pro/ | grep -c 'id="pricing"'` → `1`; packs shown as 220/$5, 480/$10, 1000/$20, 440/mo $8 (from `packages/web/src/data/pricing.ts`).
- [ ] Pages env vars are **present** (names only, do not print values): `LS_API_KEY`, `LS_STORE_ID`, `LS_WEBHOOK_SECRET`, `LS_VARIANT_STARTER`, `LS_VARIANT_STANDARD`, `LS_VARIANT_POWER`, `LS_VARIANT_MONTHLY`. Jacob confirms the variant IDs are the **live-mode** IDs, not test-mode IDs.
- [ ] Jacob confirms in the LS dashboard: webhook URL `https://wyreup.com/api/webhooks/lemonsqueezy`, signing secret matches `LS_WEBHOOK_SECRET`, events enabled: `order_created`, `order_refunded`, `subscription_created`, `subscription_payment_success`, `subscription_cancelled`, `subscription_expired`, `subscription_paused`.
- [ ] Baseline D1 counts (read-only, remote): `SELECT kind, COUNT(*), SUM(amount) FROM credit_events GROUP BY kind;` Record them. (Nov 5 handoff: 1 account, 0 credit events.)

## B. Test account

- [ ] Sign up at `/pro/` with an inbox Jacob controls (a dedicated test address). Verify via the emailed link.
- [ ] `/account` shows balance 0 and no history.
- [ ] Record the account's user id from `/account` or `SELECT id FROM users WHERE email = ?` (do not write the email into the note).

## C. Pack purchase (Starter, $5, 220 credits)

- [ ] From `/account` (or the buy sheet), choose Starter. Overlay opens on `app.lemonsqueezy.com`; no CSP errors in the browser console.
- [ ] Checkout shows the product name, $5 (plus any tax LS adds), and the test account's email pre-filled.
- [ ] Pay with Jacob's real card (live mode). LS shows success.
- [ ] Within 5 minutes the sheet closes or the balance updates without a manual reload. `/account` balance = **220**.
- [ ] Redirect / overlay success leaves the user on `/account?purchase=success` (or the overlay closes in place).
- [ ] D1: exactly one new row `kind='purchase'`, `amount=220`, `user_id` = test user, `ls_order_id` = LS order id.
- [ ] LS dashboard → Webhooks → the `order_created` delivery shows HTTP 200.
- [ ] Redelivery idempotency: Jacob clicks "Resend" on that `order_created` delivery in LS. Response 200; still exactly one purchase row; balance still 220.
- [ ] LS receipt email arrives at the test inbox.

## D. Spend and auto-refund on failure

- [ ] Run one hosted tool with a known cost on a non-sensitive input, e.g. `ocr-hq` (1 credit) on a test screenshot. Output appears; balance = 219; `/account` history shows the run.
- [ ] Optional failure path: run `pdf-q-and-a` on a PDF with no text layer. Expected: client-side error "No extractable text found in the PDF." and **no** credit change (local validation happens before reservation).
- [ ] CLI/MCP: create an API key in `/account`, run `WYREUP_API_KEY=<key> wyreup balance` → same balance. Revoke the key afterwards and confirm `wyreup balance` is rejected.

## E. Refund

- [ ] Jacob refunds the Starter order in the LS dashboard.
- [ ] `order_refunded` delivery → 200. D1: one row `kind='refund'`, `amount=-220`, `ls_order_id='<order id>:refund'`, same user.
- [ ] Balance = 219 − 220 = **−1** (the spent credit is not returned by a refund). Record how `/account` displays a negative balance and whether hosted tools are blocked. This is a product decision to review, not a pass/fail here.
- [ ] Resend the `order_refunded` delivery: still one refund row.

## F. Monthly subscription (optional, $8)

Only if Jacob authorizes the second charge.

- [ ] Choose Monthly. After payment: `order_created` → 200 with no credit row; `subscription_payment_success` → 440 credits (`kind='subscription_grant'`); `subscription_created` → `users.ls_subscription_id` set, `subscription_status` active.
- [ ] `/account` shows the subscription and the new balance.
- [ ] Cancel from the LS customer portal (or dashboard). `subscription_cancelled` → 200; `subscription_status = 'cancelled'`; already granted credits remain.
- [ ] Refund the subscription charge if Jacob wants the money back; note that a subscription refund arrives as `order_refunded` for an order with no `purchase` row, so the code returns 200 **without** debiting the 440 granted credits. Record this; decide separately whether that is acceptable.

## G. Negative checks (no money involved)

- [ ] `curl -s -o /dev/null -w '%{http_code}' -X POST https://wyreup.com/api/webhooks/lemonsqueezy -d '{}'` → `401` (no signature).
- [ ] `POST /api/credits/checkout` without a session → 401; with a session cookie but no `X-Wyreup-CSRF: 1` header → 403; with the session and that header and `{"pack":"bogus"}` → 400.

## H. Clean-up and record

- [ ] Revoke test API keys. Decide with Jacob whether to keep or delete the test account (`/api/admin/users/delete` is an admin action that needs his OK).
- [ ] Record final D1 counts vs baseline, LS order ids (not emails), webhook delivery statuses, total spent and refunded.
- [ ] Mark T21 done in `docs/ROADMAP.md` only after every required box above is checked with evidence.

## Known gaps found while writing this (not fixed here)

1. Refunding a pack after spending some credits drives the balance negative (Section E): balance is `SUM(amount)` over `credit_events` (`functions/_lib/auth.ts` `getBalance`), and admission requires balance ≥ cost (`functions/_lib/limits.ts`), so runs are blocked until the user buys more. How `/account` displays this is unverified.
2. Subscription refunds are not debited, because `order_refunded` looks only for a `purchase` row (Section F).
3. The webhook trusts `meta.custom_data.userId` for purchases. That is set server-side at checkout and covered by the HMAC, so it is fine as long as the signing secret stays private.
