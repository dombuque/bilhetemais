-- Acertos com comerciantes (comissão e pagamentos) e leituras de portaria feitas offline.
ALTER TABLE merchants ADD COLUMN commission_bps integer CHECK (commission_bps IS NULL OR commission_bps BETWEEN 0 AND 10000);

CREATE TABLE merchant_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  reference text,
  paid_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON merchant_payouts(merchant_id);

ALTER TABLE entry_scans ADD COLUMN client_id text, ADD COLUMN offline boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX entry_scans_client ON entry_scans(event_id, client_id) WHERE client_id IS NOT NULL;
