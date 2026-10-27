-- Newsletter para quem tem conta: subscrito por omissão, com saída fácil (no perfil e em cada e-mail).
ALTER TABLE accounts ADD COLUMN newsletter boolean NOT NULL DEFAULT true;
CREATE TABLE newsletter_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  body text NOT NULL,
  sent_by uuid REFERENCES users(id),
  recipients integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
