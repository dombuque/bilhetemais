-- Apelido por bilhete e partilha de bilhetes entre contas (o código renova-se ao partilhar: o antigo deixa de valer).
ALTER TABLE tickets ADD COLUMN nickname text, ADD COLUMN token_version int NOT NULL DEFAULT 0;
CREATE TABLE ticket_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  from_account_id uuid NOT NULL REFERENCES accounts(id),
  to_account_id uuid REFERENCES accounts(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_shares_ticket ON ticket_shares (ticket_id) WHERE revoked_at IS NULL;
CREATE INDEX ticket_shares_to ON ticket_shares (to_account_id) WHERE revoked_at IS NULL;
