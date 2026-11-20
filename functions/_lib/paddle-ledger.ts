import type { D1Database, D1PreparedStatement } from './env';
import type { PaddleMode } from './paddle';

export interface SubscriptionUpdate {
  id: string;
  customerId: string;
  priceId: string;
  status: string;
  time: string;
  priority: number;
  initialTransactionId: string | null;
  userId: string | null;
}

export function subscriptionUpdate(
  db: D1Database, mode: PaddleMode, update: SubscriptionUpdate,
): D1PreparedStatement {
  const newer = '(excluded.entity_time, excluded.status_priority) > (entity_time, status_priority)';
  return db.prepare(`
    INSERT INTO paddle_subscriptions
      (mode,subscription_id,customer_id,price_id,status,entity_time,status_priority,initial_transaction_id,user_id)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(mode,subscription_id) DO UPDATE SET
      customer_id=CASE WHEN customer_id=excluded.customer_id AND price_id=excluded.price_id
        AND (initial_transaction_id IS NULL OR excluded.initial_transaction_id IS NULL
          OR initial_transaction_id=excluded.initial_transaction_id) THEN customer_id END,
      initial_transaction_id=COALESCE(initial_transaction_id, excluded.initial_transaction_id),
      user_id=COALESCE(user_id, excluded.user_id),
      status=CASE WHEN ${newer} THEN excluded.status ELSE status END,
      entity_time=CASE WHEN ${newer} THEN excluded.entity_time ELSE entity_time END,
      status_priority=CASE WHEN ${newer} THEN excluded.status_priority ELSE status_priority END
  `).bind(
    mode, update.id, update.customerId, update.priceId, update.status, update.time, update.priority,
    update.initialTransactionId, update.userId,
  );
}

export interface Settlement {
  transactionId: string;
  priceId: string;
  itemId: string;
  userId: string;
  customerId: string;
  subscriptionId: string | null;
  subtotal: number;
  credits: number;
  initial: boolean;
}

export function settlementWrites(
  db: D1Database, mode: PaddleMode, purchase: Settlement,
): D1PreparedStatement[] {
  const owner = purchase.initial
    ? `SELECT 1 FROM paddle_checkouts
       WHERE mode=? AND transaction_id=? AND user_id=? AND customer_id=? AND price_id=?
         AND state IN ('open','fulfilled')`
    : `SELECT 1 FROM paddle_subscriptions
       WHERE mode=? AND subscription_id=? AND user_id=? AND customer_id=? AND price_id=?`;
  return [
    db.prepare(`
      INSERT INTO paddle_settlements
        (mode,transaction_id,item_id,user_id,customer_id,subscription_id,currency,subtotal,credits)
      VALUES (?,?,?,?,?,?,'USD',?, CASE WHEN EXISTS (${owner}) THEN ? END)
      ON CONFLICT(mode,transaction_id) DO UPDATE SET
        credits=CASE WHEN item_id=excluded.item_id AND user_id=excluded.user_id
          AND customer_id=excluded.customer_id AND subscription_id IS excluded.subscription_id
          AND subtotal=excluded.subtotal AND credits=excluded.credits THEN credits END
    `).bind(
      mode, purchase.transactionId, purchase.itemId, purchase.userId, purchase.customerId,
      purchase.subscriptionId, purchase.subtotal, mode,
      purchase.initial ? purchase.transactionId : purchase.subscriptionId,
      purchase.userId, purchase.customerId, purchase.priceId, purchase.credits,
    ),
    db.prepare(`
      INSERT INTO credit_events (id,user_id,kind,amount,note,created_at,paddle_mode,paddle_transaction_id)
      SELECT ?,user_id,CASE WHEN subscription_id IS NULL THEN 'purchase' ELSE 'subscription_grant' END,
        credits,'Paddle payment',?,mode,transaction_id
      FROM paddle_settlements WHERE mode=? AND transaction_id=?
      ON CONFLICT(paddle_mode,paddle_transaction_id)
      WHERE paddle_transaction_id IS NOT NULL AND kind IN ('purchase', 'subscription_grant')
      DO NOTHING
    `).bind(crypto.randomUUID(), Date.now(), mode, purchase.transactionId),
    db.prepare(`
      UPDATE paddle_checkouts SET state='fulfilled'
      WHERE mode=? AND transaction_id=? AND user_id=? AND state='open'
    `).bind(mode, purchase.transactionId, purchase.userId),
    reconcileAdjustments(db, mode, purchase.transactionId),
  ];
}

export interface Adjustment {
  id: string;
  transactionId: string;
  itemId: string | null;
  customerId: string;
  action: string;
  status: string;
  subtotal: number;
  time: string;
  priority: number;
}

export function adjustmentWrites(
  db: D1Database, mode: PaddleMode, adjustment: Adjustment,
): D1PreparedStatement[] {
  return [
    db.prepare(`
      INSERT INTO paddle_adjustments
        (mode,adjustment_id,transaction_id,item_id,customer_id,currency,action,status,subtotal,entity_time,status_priority)
      VALUES (?,?,?,?,?,'USD',?,?,?,?,?)
      ON CONFLICT(mode,adjustment_id) DO UPDATE SET
        transaction_id=CASE WHEN transaction_id=excluded.transaction_id AND item_id IS excluded.item_id
          AND customer_id=excluded.customer_id AND action=excluded.action THEN transaction_id END,
        status=excluded.status, subtotal=excluded.subtotal,
        entity_time=excluded.entity_time, status_priority=excluded.status_priority
      WHERE (excluded.entity_time, excluded.status_priority) > (entity_time, status_priority)
    `).bind(
      mode, adjustment.id, adjustment.transactionId, adjustment.itemId, adjustment.customerId, adjustment.action,
      adjustment.status, adjustment.subtotal, adjustment.time, adjustment.priority,
    ),
    reconcileAdjustments(db, mode, adjustment.transactionId),
  ];
}

function reconcileAdjustments(db: D1Database, mode: PaddleMode, transactionId: string): D1PreparedStatement {
  // Compare the same currency and original taxable subtotal. Sum signed
  // money before rounding so splitting a refund never changes the result.
  // Each reversal can offset only debits of its own type. Paddle can mark
  // the original reversed as well as creating a separate reversal record.
  return db.prepare(`
    WITH original AS (
      SELECT * FROM paddle_settlements WHERE mode=? AND transaction_id=?
    ), amounts AS (
      SELECT
        COALESCE(SUM(CASE WHEN a.action='refund' THEN a.subtotal ELSE 0 END), 0) AS refunds,
        MAX(0, COALESCE(SUM(CASE a.action
          WHEN 'credit' THEN a.subtotal WHEN 'credit_reverse' THEN -a.subtotal ELSE 0 END), 0)) AS credits,
        MAX(0, COALESCE(SUM(CASE a.action
          WHEN 'chargeback' THEN a.subtotal WHEN 'chargeback_reverse' THEN -a.subtotal ELSE 0 END), 0)) AS disputes
      FROM paddle_adjustments a JOIN original p
        ON a.mode=p.mode AND a.transaction_id=p.transaction_id
        AND (a.item_id=p.item_id OR a.item_id IS NULL)
        AND a.currency=p.currency AND a.customer_id=p.customer_id
      WHERE a.status='approved' OR (a.status='reversed' AND a.action IN ('credit','chargeback'))
    ), desired AS (
      SELECT
        p.*,
        -(p.credits * MIN(p.subtotal, refunds + amounts.credits + disputes) + p.subtotal / 2) / p.subtotal AS debit,
        COALESCE((SELECT SUM(amount) FROM credit_events c
          WHERE c.paddle_mode=p.mode AND c.paddle_transaction_id=p.transaction_id AND c.kind='refund'), 0) AS prior
      FROM original p CROSS JOIN amounts
    )
    INSERT INTO credit_events (id,user_id,kind,amount,note,created_at,paddle_mode,paddle_transaction_id)
    SELECT ?,user_id,'refund',debit-prior,'Paddle payment adjustment',?,mode,transaction_id
    FROM desired WHERE debit != prior
  `).bind(mode, transactionId, crypto.randomUUID(), Date.now());
}
