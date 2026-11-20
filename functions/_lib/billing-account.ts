import type { Env } from './env';
import { BILLABLE, LEGACY_MONTHLY_CLEAR } from './paddle';

export async function billingAccount(userId: string, env: Env) {
  const row = await env.DB.prepare(`
    WITH current_paddle AS (
      SELECT s.status FROM paddle_subscriptions s JOIN paddle_billing_mode m ON m.mode=s.mode
      WHERE m.id=1 AND s.user_id=?
      ORDER BY (s.status IN ${BILLABLE}) DESC, s.entity_time DESC, s.subscription_id DESC
      LIMIT 1
    )
    SELECT u.subscription_status AS legacy_status, u.ls_subscription_id,
      CASE WHEN ${LEGACY_MONTHLY_CLEAR} THEN 0 ELSE 1 END AS legacy_billable,
      p.status AS paddle_status,
      EXISTS (
        SELECT 1 FROM paddle_settlements paid JOIN paddle_billing_mode m ON m.mode=paid.mode
        WHERE m.id=1 AND paid.user_id=u.id
      ) AS has_paddle_purchase
    FROM users u LEFT JOIN current_paddle p ON 1=1 WHERE u.id=?
  `).bind(userId, userId).first<{
    legacy_status: string | null;
    ls_subscription_id: string | null;
    legacy_billable: number;
    paddle_status: string | null;
    has_paddle_purchase: number;
  }>();
  const legacyStatus = row?.legacy_status ?? null;
  const paddleStatus = row?.paddle_status ?? null;
  const legacyBillable = !!row?.legacy_billable;
  const paddleBillable = paddleStatus !== null && paddleStatus !== 'cancelled';
  const showPaddle = paddleStatus !== null && (paddleBillable || !legacyBillable);
  return {
    subscriptionStatus: showPaddle ? paddleStatus : legacyStatus,
    subscriptionProvider: showPaddle ? 'paddle' : row?.ls_subscription_id ? 'lemonsqueezy' : null,
    monthlyCheckoutBlocked: legacyBillable || paddleBillable,
    canManagePaddleBilling: !!row?.has_paddle_purchase,
  };
}
