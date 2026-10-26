-- Reembolso de comerciante (crédito) e levantamento de saldo (débito)
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='wallet_ledger_entries'::regclass AND contype='c' LOOP
    EXECUTE format('ALTER TABLE wallet_ledger_entries DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE wallet_ledger_entries
  ADD CONSTRAINT ledger_amount_nonzero CHECK (amount_minor <> 0),
  ADD CONSTRAINT ledger_status CHECK (status = 'POSTED'),
  ADD CONSTRAINT ledger_type CHECK (type IN ('TOPUP','PAYMENT','REFUND','CASHOUT','ADJUSTMENT')),
  ADD CONSTRAINT ledger_sign CHECK (type = 'ADJUSTMENT' OR ((type IN ('TOPUP','REFUND')) = (amount_minor > 0))),
  ADD CONSTRAINT ledger_payment_merchant CHECK (type <> 'PAYMENT' OR merchant_id IS NOT NULL),
  ADD CONSTRAINT ledger_refund_original CHECK (type <> 'REFUND' OR original_entry_id IS NOT NULL);
CREATE UNIQUE INDEX one_refund_per_entry ON wallet_ledger_entries(original_entry_id) WHERE type='REFUND';

ALTER TABLE events
  ADD COLUMN description text,
  ADD COLUMN balance_refund_allowed boolean NOT NULL DEFAULT false;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id),
  merchant_id uuid REFERENCES merchants(id),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('PLATFORM_ADMIN','ORG_ADMIN','CASHIER','MERCHANT_OPERATOR','GATE_OPERATOR')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'PLATFORM_ADMIN') = (organization_id IS NULL)),
  CHECK ((role = 'MERCHANT_OPERATOR') = (merchant_id IS NOT NULL))
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  name text NOT NULL,
  price_minor bigint NOT NULL CHECK (price_minor > 0),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE merchant_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  ledger_entry_id uuid NOT NULL UNIQUE REFERENCES wallet_ledger_entries(id),
  operator_id uuid NOT NULL REFERENCES users(id),
  items jsonb NOT NULL,
  total_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'GENERAL' CHECK (kind IN ('GENERAL','VIP','GUEST','PRESS','STAFF','FREE','PROMO')),
  price_minor bigint NOT NULL CHECK (price_minor >= 0),
  quantity integer NOT NULL CHECK (quantity > 0)
);
CREATE TABLE ticket_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  channel text NOT NULL CHECK (channel IN ('ONLINE','COUNTER')),
  buyer_name text NOT NULL,
  buyer_contact text,
  total_minor bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING_PAYMENT','PAID','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  order_id uuid NOT NULL REFERENCES ticket_orders(id),
  ticket_type_id uuid NOT NULL REFERENCES ticket_types(id),
  wallet_id uuid REFERENCES wallets(id),
  token_hash text NOT NULL UNIQUE,
  format text NOT NULL DEFAULT 'DIGITAL' CHECK (format IN ('DIGITAL','PHYSICAL')),
  status text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('PENDING','ISSUED','USED','REVOKED')),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE access_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  name text NOT NULL
);
CREATE TABLE entry_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  gate_id uuid REFERENCES access_gates(id),
  ticket_id uuid REFERENCES tickets(id),
  operator_id uuid NOT NULL REFERENCES users(id),
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cashier_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  counted_minor bigint,
  expected_minor bigint,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX one_open_session_per_user ON cashier_sessions(user_id) WHERE status='OPEN';
CREATE TABLE cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES cashier_sessions(id),
  kind text NOT NULL CHECK (kind IN ('TOPUP','TICKET_SALE')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  ledger_entry_id uuid REFERENCES wallet_ledger_entries(id),
  order_id uuid REFERENCES ticket_orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE topup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  provider text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','FAILED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE webhook_events (
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_event_id)
);
CREATE TABLE refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  decided_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  user_id uuid,
  action text NOT NULL,
  entity text,
  entity_id text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON tickets(event_id);
CREATE INDEX ON entry_scans(event_id);
