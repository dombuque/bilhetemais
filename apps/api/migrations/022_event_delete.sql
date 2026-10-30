-- Eliminar evento: fica escondido (nunca se apaga o registo) e guarda quem, quando e porquê. A auditoria regista também a acção.
ALTER TABLE events ADD COLUMN deleted_at timestamptz, ADD COLUMN deleted_by uuid REFERENCES users(id), ADD COLUMN delete_reason text;
CREATE INDEX events_not_deleted ON events (organization_id) WHERE deleted_at IS NULL;

-- Percurso da empresa registada: quando enviou os documentos para análise.
ALTER TABLE organizations ADD COLUMN docs_submitted_at timestamptz;
