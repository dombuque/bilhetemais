-- Identidade visual: tema por empresa (valores por omissão) e por evento (substitui os da empresa).
ALTER TABLE organizations ADD COLUMN theme jsonb NOT NULL DEFAULT '{}';
ALTER TABLE events ADD COLUMN theme jsonb NOT NULL DEFAULT '{}';

CREATE TABLE brand_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('logo','cover')),
  content_type text NOT NULL CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
  data bytea NOT NULL CHECK (octet_length(data) <= 1048576),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((organization_id IS NULL) <> (event_id IS NULL))
);
CREATE UNIQUE INDEX brand_asset_event ON brand_assets(event_id, kind) WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX brand_asset_org ON brand_assets(organization_id, kind) WHERE organization_id IS NOT NULL;
