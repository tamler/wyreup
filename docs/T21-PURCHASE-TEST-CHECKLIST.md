# T21 — end-to-end purchase test checklist

Use this checklist after configuring the [sandbox billing environment](../DEPLOYMENT.md#paddle-billing). A source change or synthetic test does not mark T21 complete.

Record each observation with the deployment commit, timestamp, and environment. Keep API keys, webhook secrets, cookies, payment details, customer emails, and portal links out of evidence.

## A. Read-only preflight

- [ ] Confirm the sandbox checkout is on its dedicated hostname and D1 and that no PADDLE setting comes from live. Check the database mode marker and notification destination without printing secret values.
- [ ] Confirm the approved catalog displays 220 credits for $5, 480 for $10, 1,000 for $20, and 440 per paid $8 monthly cycle. Verify the corresponding Paddle catalog settings.
- [ ] Confirm the candidate source and build, then record aggregate baseline ledger counts for the sandbox fixture.
- [ ] Use existing authorized synthetic-account access. The current scope skips the signed-in Pro model test and does not authorize creating accounts or sending rehearsal email.

## B. Pack checkout

- [ ] Start a pack checkout from the buy sheet. Click **Continue to Paddle checkout** and observe the correct product, quantity one, price, and customer. Check that the Paddle SDK and frame only load on `/checkout` and no required checkout request is blocked by CSP.
- [ ] Complete the test payment using Paddle sandbox. Observe `transaction.completed` delivery and exactly one purchase row with the test account's user ID and Paddle transaction ID. Verify the original tab confirms that transaction and the account balance reflects its credit grant.
- [ ] Redeliver the completed notification and confirm the same balance and one purchase row. Simulate an unrelated balance change and confirm the sheet still waits for its own transaction.
- [ ] Repeat for the other pack amounts. Confirm the payment link remains usable after a retry and concurrent clicks do not create a second payable transaction.
- [ ] In a disposable local fixture, simulate an interrupted checkout with an unbound transaction. Confirm a fresh retry reports preparation and a retry after 120 seconds holds the reservation for support without creating a new transaction. Verify that a concurrent binding returns only the exact stored transaction. Use the [billing deployment guide](../DEPLOYMENT.md#paddle-billing) to review open holds against the stored environment, intent, customer, catalog, and time.

## C. Refund and adjustment

- [ ] Apply a sandbox partial refund. Confirm pending approval leaves the balance alone. Once approved, compare the same-currency pre-tax refunded amount and the expected prorated credit deduction. Resend the notification and confirm no double debit.
- [ ] Check approved full adjustments, tax-only adjustments, chargebacks and reversals. Confirm the deduction never exceeds the original grant and a reversal cannot restore more than the related debit.
- [ ] Use synthetic fixtures for an earlier spend and reordered events. A purchase refund can take the balance below zero when its credits have already been spent.

## D. Monthly plan and portal

- [ ] Confirm the initial paid checkout grants 440 credits once. A subscription lifecycle event alone does not grant credits.
- [ ] Qualify renewal in sandbox. Confirm one additional grant per completed recurring transaction and rejection of a second monthly checkout while a subscription remains billable.
- [ ] Use **Manage Paddle billing** on the account. Verify the authenticated portal belongs to the signed-in account. Test the payment-method update link and cancellation, confirm lifecycle notification order does not regress the status, and verify already purchased credits remain.
- [ ] Confirm stored Lemon Squeezy balances and open legacy obligations have a verified disposition before live activation. Their notifications and receipt links continue handling the earlier purchases during the transition.

## E. Negative checks and closeout

- [ ] Verify checkout rejects a missing session, a missing cookie CSRF header, and an unknown pack. Check that another account cannot retrieve checkout state or create a portal session for the test customer.
- [ ] Verify the webhook rejects missing and invalid signatures. Check that changing the database mode, origin, or credential mode fails closed in a disposable local fixture.
- [ ] Record sandbox transaction IDs, delivery status, balances and the source commit. Handle test keys or records under the agreed scope.
- [ ] Before any live activation, verify the live account and checkout domain are approved, the protected-source rehearsal is current, and exact-head CI and independent review are green. Independently authorized live checks can verify the deployed price display, route configuration, and the production webhook's rejection of unsigned requests. A live purchase or refund requires explicit approval.
