-- Contas de participantes: para comprar bilhetes é preciso ter sessão iniciada.
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  phone text,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DELETED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounts_email ON accounts (lower(email));
CREATE TABLE account_sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX account_sessions_account ON account_sessions(account_id);
ALTER TABLE ticket_orders ADD COLUMN account_id uuid REFERENCES accounts(id);
CREATE INDEX ticket_orders_account ON ticket_orders(account_id, created_at DESC);
