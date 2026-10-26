-- Descoberta pública de eventos: categoria e pesquisa sem acentos.
ALTER TABLE events ADD COLUMN category text
  CHECK (category IS NULL OR category IN ('MUSICA','FESTIVAL','CONFERENCIA','FEIRA','DESPORTO','TEATRO','GASTRONOMIA','EMPRESARIAL','OUTRO'));
CREATE INDEX events_public_idx ON events(status, ends_at) WHERE status = 'PUBLISHED';

-- minúsculas e sem acentos (português), para "Música" casar com "musica"
CREATE FUNCTION bp_norm(t text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT translate(lower(t), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') $$;
