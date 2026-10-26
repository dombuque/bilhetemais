-- Parâmetros por evento, com herança opcional de outro evento da mesma empresa.
-- Só se guardam os valores que o evento define; o resto vem do evento-pai ou dos valores por omissão.
ALTER TABLE events
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN parent_event_id uuid REFERENCES events(id),
  ADD CONSTRAINT events_not_own_parent CHECK (parent_event_id IS NULL OR parent_event_id <> id);
CREATE INDEX events_parent ON events(parent_event_id);
