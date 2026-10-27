-- Controlo de bilhetes pela equipa: bloquear (reversível) e cancelar (definitivo), sempre com justificação.
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check CHECK (status IN ('PENDING','ISSUED','USED','REVOKED','BLOCKED'));
ALTER TABLE tickets ADD COLUMN status_reason text;
ALTER TABLE tickets ADD COLUMN status_before text;
ALTER TABLE tickets ADD COLUMN status_changed_by uuid REFERENCES users(id);
ALTER TABLE tickets ADD COLUMN status_changed_at timestamptz;
CREATE INDEX tickets_event_status ON tickets(event_id, status);
