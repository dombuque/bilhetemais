-- Cobranças M-Pesa (recargas e pagamento de bilhetes). O registo de negócio (recarga/encomenda) só muda
-- quando o M-Pesa confirma, pelo mesmo caminho idempotente dos webhooks.
CREATE TABLE mpesa_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('TOPUP','ORDER')),
  ref_id uuid NOT NULL,
  msisdn text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','FAILED')),
  provider_ref text,
  code text,
  failure_reason text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mpesa_charges_open ON mpesa_charges(status, created_at);
-- no máximo uma cobrança em curso por recarga/encomenda (protege contra duplo clique)
CREATE UNIQUE INDEX one_open_charge ON mpesa_charges(kind, ref_id) WHERE status = 'PENDING';
