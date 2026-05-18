// POST /api/webhooks/lemonsqueezy
// Constant-time HMAC verify; idempotent insert via UNIQUE(ls_order_id).
// Handles `order_created` (purchase) and `order_refunded`.
// See docs/pro-auth-spec.md §11.

import type { Env } from '../../_lib/env';
import type { PagesFunction } from '../../_lib/types';
import { hmacSha256Hex, nanoid, timingSafeEqualHex } from '../../_lib/crypto';

// We do this lookup at the edge instead of trusting the webhook payload's
// price/qty fields. variant_id → credits is the only signal we honor.
function creditsForVariant(env: Env, variantId: string): number | null {
  if (variantId === env.LS_VARIANT_STARTER) return 50;
  if (variantId === env.LS_VARIANT_STANDARD) return 150;
  if (variantId === env.LS_VARIANT_POWER) return 400;
  return null;
}

interface WebhookPayload {
  meta?: { event_name?: string; custom_data?: { userId?: string } };
  data?: {
    id?: string | number;
    attributes?: {
      status?: string;
      first_order_item?: { variant_id?: string | number };
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

  return new Response('OK');
};
