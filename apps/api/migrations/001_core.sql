CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  trade_name text NOT NULL,
  nuit text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  capacity integer CHECK (capacity > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_domains (
  subdomain text PRIMARY KEY CHECK (subdomain ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  event_id uuid NOT NULL UNIQUE REFERENCES events(id)
);

CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  currency char(3) NOT NULL DEFAULT 'MZN',
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Várias credenciais por carteira; o token nunca é guardado em claro.
CREATE TABLE wallet_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  kind text NOT NULL CHECK (kind IN ('PHYSICAL_TICKET','NFC','APP_QR')),
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED','REVOKED')),
  replaced_by uuid REFERENCES wallet_credentials(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  name text NOT NULL
);

-- Ledger append-only. amount_minor em centavos: positivo = crédito, negativo = débito.
CREATE TABLE wallet_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  type text NOT NULL CHECK (type IN ('TOPUP','PAYMENT','REFUND','ADJUSTMENT')),
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  currency char(3) NOT NULL DEFAULT 'MZN',
  status text NOT NULL DEFAULT 'POSTED' CHECK (status = 'POSTED'),
  merchant_id uuid REFERENCES merchants(id),
  credential_id uuid REFERENCES wallet_credentials(id),
  external_ref text,
  operator text NOT NULL,
  idempotency_key text NOT NULL,
  original_entry_id uuid REFERENCES wallet_ledger_entries(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wallet_id, idempotency_key),
  CHECK ((type IN ('TOPUP','REFUND')) = (amount_minor > 0) OR type = 'ADJUSTMENT'),
  CHECK (type <> 'PAYMENT' OR merchant_id IS NOT NULL)
);
CREATE INDEX ON wallet_ledger_entries (wallet_id, created_at);

CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'wallet_ledger_entries is append-only'; END $$;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON wallet_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
