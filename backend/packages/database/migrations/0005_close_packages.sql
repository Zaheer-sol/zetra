CREATE TABLE close_packages (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  environment text NOT NULL CHECK (environment IN ('test','live')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  ledger_version text NOT NULL,
  schema_version text NOT NULL,
  canonical_hash text NOT NULL,
  artifact jsonb NOT NULL,
  artifact_metadata jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','attested','verification_failed')),
  near_network text,
  contract_account text,
  transaction_hash text,
  block_hash text,
  explorer_url text,
  created_by text,
  created_by_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, environment, period_start, period_end, canonical_hash)
);
CREATE INDEX close_packages_org_period ON close_packages(organization_id, environment, period_end DESC);
ALTER TABLE close_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE close_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_policy ON close_packages USING (tenant_visible(organization_id)) WITH CHECK (tenant_visible(organization_id));
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zetra_app') THEN
    GRANT SELECT,INSERT,UPDATE ON close_packages TO zetra_app;
  END IF;
END $$;
