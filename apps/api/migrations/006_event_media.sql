-- Conteúdo da página do evento: localização, galeria de imagens e programação.
ALTER TABLE events ADD COLUMN location text, ADD COLUMN map_url text CHECK (map_url IS NULL OR map_url ~ '^https://');

CREATE TABLE event_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  data bytea NOT NULL CHECK (octet_length(data) <= 1048576),
  caption text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON event_images(event_id, position);

CREATE TABLE event_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  stage text,
  description text,
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX ON event_sessions(event_id, starts_at);
