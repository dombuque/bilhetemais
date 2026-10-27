-- Entrada com Google: identidades externas, estado do OAuth (uso único) e e-mail verificado.
ALTER TABLE accounts ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
CREATE TABLE account_identities (
  provider text NOT NULL,
  subject text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX account_identities_account ON account_identities(account_id);
CREATE TABLE oauth_states (
  state_hash text PRIMARY KEY,
  verifier text NOT NULL,
  next text NOT NULL,
  expires_at timestamptz NOT NULL
);
