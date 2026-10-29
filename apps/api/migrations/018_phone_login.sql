-- Entrada por telemóvel (código por SMS): contas sem e-mail nem palavra-passe, identificadas pelo número.
ALTER TABLE accounts ALTER COLUMN email DROP NOT NULL;
ALTER TABLE accounts ADD COLUMN phone_e164 text;
CREATE UNIQUE INDEX accounts_phone ON accounts (phone_e164) WHERE phone_e164 IS NOT NULL AND status = 'ACTIVE';
CREATE TABLE phone_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phone_codes_phone ON phone_codes (phone, created_at DESC);
