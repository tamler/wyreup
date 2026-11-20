CREATE TABLE paddle_billing_mode (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL CHECK (mode IN ('disabled', 'sandbox', 'live'))
);
INSERT INTO paddle_billing_mode VALUES (1, 'disabled');

CREATE TRIGGER paddle_billing_mode_once
BEFORE UPDATE OF mode ON paddle_billing_mode
WHEN OLD.mode != 'disabled' AND NEW.mode != OLD.mode
BEGIN
  SELECT RAISE(ABORT, 'Paddle database already assigned to an environment');
END;

CREATE TABLE paddle_customers (
  mode TEXT NOT NULL CHECK (mode IN ('sandbox', 'live')),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  PRIMARY KEY (mode, user_id),
  UNIQUE (mode, customer_id)
);

CREATE TABLE paddle_checkouts (
  mode TEXT NOT NULL CHECK (mode IN ('sandbox', 'live')),
  intent_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack TEXT NOT NULL CHECK (pack IN ('starter', 'standard', 'power', 'monthly')),
  price_id TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),
  unit_amount INTEGER NOT NULL CHECK (unit_amount > 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  quantity INTEGER NOT NULL CHECK (quantity = 1),
  state TEXT NOT NULL CHECK (state IN ('creating', 'open', 'blocked', 'cancelled', 'fulfilled')),
  created_at INTEGER NOT NULL,
  customer_id TEXT,
  transaction_id TEXT,
  PRIMARY KEY (mode, intent_id),
  UNIQUE (mode, transaction_id)
);

CREATE UNIQUE INDEX paddle_one_open_checkout ON paddle_checkouts(mode, user_id, pack)
WHERE state IN ('creating', 'open', 'blocked');

CREATE TABLE paddle_subscriptions (
  mode TEXT NOT NULL CHECK (mode IN ('sandbox', 'live')),
  subscription_id TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  initial_transaction_id TEXT,
  customer_id TEXT NOT NULL,
  price_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'trialing', 'past_due', 'paused', 'cancelled')),
  entity_time TEXT NOT NULL,
  status_priority INTEGER NOT NULL,
  PRIMARY KEY (mode, subscription_id),
  UNIQUE (mode, initial_transaction_id),
  CHECK ((user_id IS NULL) = (initial_transaction_id IS NULL))
);

CREATE UNIQUE INDEX paddle_one_billable_subscription ON paddle_subscriptions(mode, user_id)
WHERE status IN ('active', 'trialing', 'past_due', 'paused');

CREATE TABLE paddle_settlements (
  mode TEXT NOT NULL CHECK (mode IN ('sandbox', 'live')),
  transaction_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  subscription_id TEXT,
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  subtotal INTEGER NOT NULL CHECK (subtotal BETWEEN 1 AND 2000),
  credits INTEGER NOT NULL CHECK (credits BETWEEN 1 AND 1000),
  PRIMARY KEY (mode, transaction_id)
);
CREATE INDEX paddle_settlements_owner ON paddle_settlements(mode, user_id);

CREATE TABLE paddle_adjustments (
  mode TEXT NOT NULL CHECK (mode IN ('sandbox', 'live')),
  adjustment_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  item_id TEXT,
  customer_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  action TEXT NOT NULL CHECK (action IN ('refund', 'credit', 'credit_reverse', 'chargeback', 'chargeback_reverse')),
  status TEXT NOT NULL CHECK (status IN ('pending_approval', 'approved', 'rejected', 'reversed')),
  subtotal INTEGER NOT NULL CHECK (subtotal BETWEEN 0 AND 1000000000),
  entity_time TEXT NOT NULL,
  status_priority INTEGER NOT NULL,
  PRIMARY KEY (mode, adjustment_id)
);
CREATE INDEX paddle_adjustments_transaction ON paddle_adjustments(mode, transaction_id, item_id);

CREATE TABLE paddle_events (
  mode TEXT NOT NULL CHECK (mode IN ('sandbox', 'live')),
  event_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  PRIMARY KEY (mode, event_id)
);

ALTER TABLE credit_events ADD COLUMN paddle_mode TEXT;
ALTER TABLE credit_events ADD COLUMN paddle_transaction_id TEXT;

CREATE INDEX paddle_credit_lineage ON credit_events(paddle_mode, paddle_transaction_id)
WHERE paddle_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX paddle_only_one_grant ON credit_events(paddle_mode, paddle_transaction_id)
WHERE paddle_transaction_id IS NOT NULL AND kind IN ('purchase', 'subscription_grant');
