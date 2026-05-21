// POST /api/webhooks/lemonsqueezy
// Constant-time HMAC verify; idempotent insert via UNIQUE(ls_order_id).
// Handles order_created/order_refunded for one-time packs and
// subscription_created / _payment_success / _cancelled / _expired /
// _paused for the monthly plan. See docs/pro-auth-spec.md §11.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { hmacSha256Hex, nanoid, timingSafeEqualHex } from '../../_lib/crypto';

// We do this lookup at the edge instead of trusting the webhook payload's
// price/qty fields. variant_id → credits is the only signal we honor.
function creditsForVariant(env: Env, variantId: string): number | null {
  if (variantId === env.LS_VARIANT_STARTER) return 150;
  if (variantId === env.LS_VARIANT_STANDARD) return 330;
  if (variantId === env.LS_VARIANT_POWER) return 680;
  return null;
}

// Single monthly plan today. If we add tiers, key off variant_id like packs.
const MONTHLY_CREDITS_PER_CYCLE = 300;

interface WebhookPayload {
  meta?: { event_name?: string; custom_data?: { userId?: string } };
  data?: {
    id?: string | number;
    type?: string;
    attributes?: {
      status?: string;
      first_order_item?: { variant_id?: string | number };
      // subscription event fields
      variant_id?: string | number;
      subscription_id?: string | number;
    };
  };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 1. Constant-time HMAC verify
  const sigHex = (request.headers.get('X-Signature') ?? '').trim();
  const body = await request.text();
  if (!env.LS_WEBHOOK_SECRET) {
    return new Response('Webhook secret not configured', { status: 500 });
  }
  const expectedHex = await hmacSha256Hex(env.LS_WEBHOOK_SECRET, body);
  if (!timingSafeEqualHex(sigHex, expectedHex)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(body) as WebhookPayload;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const event = payload.meta?.event_name;
  const userId = payload.meta?.custom_data?.userId;
  if (!userId) return new Response('Missing custom_data.userId', { status: 400 });

  // Confirm the user exists before any INSERT. Without this, a malformed
  // or replayed webhook with a fabricated userId would hit a D1 FK
  // constraint and surface as a 500 — which LS then retries indefinitely.
  // 400 here tells LS to stop retrying.
  const userExists = await env.DB.prepare(`SELECT 1 AS ok FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ ok: number }>();
  if (!userExists) return new Response('Unknown user', { status: 400 });

  const orderId = payload.data?.id != null ? String(payload.data.id) : '';
  if (!orderId) return new Response('Missing order id', { status: 400 });

  // order_created --------------------------------------------------------
  if (event === 'order_created' && payload.data?.attributes?.status === 'paid') {
    const variantId = String(payload.data.attributes.first_order_item?.variant_id ?? '');
    // LS fires order_created for subscription sign-ups too. Credits for
    // those flow through subscription_payment_success — ack and skip
    // here so the order-pack path doesn't 400 on a known variant.
    if (env.LS_VARIANT_MONTHLY && variantId === env.LS_VARIANT_MONTHLY) {
      return new Response('OK');
    }
    const credits = creditsForVariant(env, variantId);
    if (!credits) return new Response('Unknown variant', { status: 400 });

    await env.DB.prepare(
      `INSERT OR IGNORE INTO credit_events
         (id, user_id, kind, amount, ls_order_id, note, created_at)
       VALUES (?, ?, 'purchase', ?, ?, ?, ?)`,
    )
      .bind(
        `evt_${nanoid(16)}`,
        userId,
        credits,
        orderId,
        `Purchased ${credits} credits`,
        Date.now(),
      )
      .run();

    return new Response('OK');
  }

  // order_refunded -------------------------------------------------------
  if (event === 'order_refunded') {
    const original = await env.DB.prepare(
      `SELECT amount FROM credit_events
        WHERE ls_order_id = ? AND kind = 'purchase'`,
    )
      .bind(orderId)
      .first<{ amount: number }>();
    if (!original) return new Response('OK');

    await env.DB.prepare(
      `INSERT OR IGNORE INTO credit_events
         (id, user_id, kind, amount, ls_order_id, note, created_at)
       VALUES (?, ?, 'refund', ?, ?, ?, ?)`,
    )
      .bind(
        `evt_${nanoid(16)}`,
        userId,
        -original.amount,
        `${orderId}:refund`,
        `Refund for order ${orderId}`,
        Date.now(),
      )
      .run();

    return new Response('OK');
  }

  // subscription_created -------------------------------------------------
  // Record the LS subscription id on the user. Credits are NOT granted
  // here — the first paid invoice fires subscription_payment_success
  // immediately after and grants there. Validates variant matches the
  // configured monthly plan to reject unrelated subscription products.
  if (event === 'subscription_created') {
    const variantId = String(payload.data?.attributes?.variant_id ?? '');
    if (!env.LS_VARIANT_MONTHLY || variantId !== env.LS_VARIANT_MONTHLY) {
      return new Response('Unknown subscription variant', { status: 400 });
    }
    const status = payload.data?.attributes?.status ?? 'active';
    await env.DB.prepare(
      `UPDATE users
          SET ls_subscription_id = ?,
              subscription_status = ?
        WHERE id = ?`,
    )
      .bind(orderId, status, userId)
      .run();
    return new Response('OK');
  }

  // subscription_payment_success -----------------------------------------
  // Fires on the initial invoice and every renewal. Grants credits
  // idempotently via UNIQUE(ls_order_id) keyed by invoice id. Also
  // upserts the subscription on the user in case events arrived out of
  // order (payment_success before subscription_created).
  if (event === 'subscription_payment_success') {
    const subscriptionId = String(payload.data?.attributes?.subscription_id ?? '');
    if (!subscriptionId) return new Response('Missing subscription id', { status: 400 });

    await env.DB.prepare(
      `INSERT OR IGNORE INTO credit_events
         (id, user_id, kind, amount, ls_order_id, note, created_at)
       VALUES (?, ?, 'subscription_grant', ?, ?, ?, ?)`,
    )
      .bind(
        `evt_${nanoid(16)}`,
        userId,
        MONTHLY_CREDITS_PER_CYCLE,
        `sub_${subscriptionId}:inv_${orderId}`,
        `Monthly subscription — ${MONTHLY_CREDITS_PER_CYCLE} credits`,
        Date.now(),
      )
      .run();

    // Keep subscription state in sync. Two concerns handled here:
    //   1. A user who cancels and re-subscribes generates a new
    //      subscription_id; overwrite ls_subscription_id unconditionally
    //      so the cancel handler below can match against the current sub.
    //   2. A late payment_success arriving after a cancelled/expired
    //      event must not flip status back to 'active'. The guard limits
    //      the status overwrite to non-terminal states.
    await env.DB.prepare(
      `UPDATE users
          SET ls_subscription_id = ?,
              subscription_status = CASE
                WHEN subscription_status IN ('cancelled','expired')
                  THEN subscription_status
                ELSE 'active'
              END
        WHERE id = ?`,
    )
      .bind(subscriptionId, userId)
      .run();

    return new Response('OK');
  }

  // subscription_cancelled / _expired / _paused --------------------------
  // Status-only updates. Credits already granted to date are kept (the
  // user paid for that cycle). New grants stop because no further
  // payment_success events will fire.
  if (
    event === 'subscription_cancelled' ||
    event === 'subscription_expired' ||
    event === 'subscription_paused'
  ) {
    const status =
      event === 'subscription_cancelled'
        ? 'cancelled'
        : event === 'subscription_expired'
          ? 'expired'
          : 'paused';
    const res = await env.DB.prepare(
      `UPDATE users
          SET subscription_status = ?
        WHERE id = ? AND ls_subscription_id = ?`,
    )
      .bind(status, userId, orderId)
      .run();
    // Out-of-order delivery: if subscription_created hasn't landed yet
    // we'd silently no-op and the status would never reflect the cancel.
    // Returning 500 makes LS retry with backoff; by then _created has
    // typically arrived and the UPDATE will match.
    if ((res.meta?.changes ?? 0) === 0) {
      console.warn(
        'LS webhook',
        event,
        'no-op for user',
        userId,
        'sub',
        orderId,
        '— retrying',
      );
      return new Response('Subscription not yet recorded — retry', { status: 500 });
    }
    return new Response('OK');
  }

  return new Response('OK');
};
