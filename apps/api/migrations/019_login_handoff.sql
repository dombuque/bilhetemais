-- Entrada com Google a partir da app instalada: o retorno do Google abre noutro contexto do telemóvel (navegador),
-- por isso a sessão passa à app por um pedido secreto (handoff), de uso único e curta duração.
ALTER TABLE oauth_states ADD COLUMN handoff_hash text;
CREATE TABLE login_handoffs (
  rid_hash text PRIMARY KEY,
  sealed text NOT NULL,
  expires_at timestamptz NOT NULL
);
