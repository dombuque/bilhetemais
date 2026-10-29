-- Código curto (8 caracteres) por bilhete: serve para a portaria o digitar quando o QR não lê.
ALTER TABLE tickets ADD COLUMN short_code text;
UPDATE tickets SET short_code = upper(translate(substr(md5(id::text || random()::text), 1, 8), '0123456789abcdef', 'ACDEFGHJKMNPQRTW'));
CREATE UNIQUE INDEX tickets_short_code ON tickets (event_id, short_code);
