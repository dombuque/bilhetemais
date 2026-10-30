-- Apagar empresa (só sem vendas): fica arquivada (quem, quando, porquê); NUIT, endereço e e-mails ficam livres para novo registo.
ALTER TABLE organizations ADD COLUMN deleted_at timestamptz, ADD COLUMN deleted_by uuid REFERENCES users(id), ADD COLUMN delete_reason text;
