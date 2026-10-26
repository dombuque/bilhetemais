-- Cada empresa tem um identificador próprio (slug) que dá o endereço da sua área de entrada: /empresa/<slug>.
ALTER TABLE organizations ADD COLUMN slug text;
WITH base AS (
  SELECT id, created_at,
         CASE WHEN length(b) < 3 THEN 'empresa' ELSE left(b, 38) END AS b
    FROM (SELECT id, created_at, trim(both '-' from lower(regexp_replace(trade_name, '[^a-zA-Z0-9]+', '-', 'g'))) AS b FROM organizations) t
), numbered AS (
  SELECT id, b, row_number() OVER (PARTITION BY b ORDER BY created_at, id) AS rn FROM base
)
UPDATE organizations o SET slug = CASE WHEN n.rn = 1 THEN n.b ELSE left(n.b, 34) || '-' || n.rn END FROM numbered n WHERE o.id = n.id;
ALTER TABLE organizations
  ALTER COLUMN slug SET NOT NULL,
  ADD CONSTRAINT organizations_slug_key UNIQUE (slug),
  ADD CONSTRAINT organizations_slug_fmt CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
