-- MFA (TOTP) opcional por utilizador e fila de notificações por e-mail.
ALTER TABLE users
  ADD COLUMN mfa_secret text,                      -- cifrado (AES-256-GCM); nunca em claro
  ADD COLUMN mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN mfa_last_step bigint,                 -- impede reutilização do mesmo código
  ADD COLUMN mfa_recovery jsonb NOT NULL DEFAULT '[]'; -- hashes dos códigos de recuperação

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','SKIPPED')),
  error text,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX ON notifications(created_at);
