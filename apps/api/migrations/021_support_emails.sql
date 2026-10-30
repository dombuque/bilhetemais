-- E-mails de suporte da Bilhete+ (geridos no backoffice): recebem o aviso de cada nova empresa registada.
CREATE TABLE support_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX support_emails_email ON support_emails (lower(email));
