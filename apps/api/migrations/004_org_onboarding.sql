-- Registo self-service: dados de contacto/facturação, revisão pela plataforma e documentos.
ALTER TABLE organizations DROP CONSTRAINT organizations_status_check;
ALTER TABLE organizations ADD CONSTRAINT organizations_status_check CHECK (status IN ('PENDING','ACTIVE','REJECTED','SUSPENDED','DISABLED'));
ALTER TABLE organizations
  ADD COLUMN address text,
  ADD COLUMN phone text,
  ADD COLUMN contact_name text,
  ADD COLUMN billing_email text,
  ADD COLUMN website text,
  ADD COLUMN status_reason text,
  ADD COLUMN reviewed_by uuid REFERENCES users(id),
  ADD COLUMN reviewed_at timestamptz;

CREATE TABLE org_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('application/pdf','image/png','image/jpeg')),
  data bytea NOT NULL CHECK (octet_length(data) <= 3145728),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON org_documents(organization_id);
