-- Notificações push: subscrições dos aparelhos (com ou sem conta) e avisos já enviados (para não repetir lembretes).
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  topics text[] NOT NULL DEFAULT '{events,tickets}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_account ON push_subscriptions(account_id);
CREATE TABLE push_sent (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, event_id, kind)
);
