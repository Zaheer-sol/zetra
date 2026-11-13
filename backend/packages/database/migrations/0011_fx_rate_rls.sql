-- Tenant-specific rates are private. Published reference rates (organization_id IS NULL) are
-- readable by every workspace, but only system-scoped workers may create or change them.
CREATE UNIQUE INDEX fx_rates_identity
  ON fx_rates (COALESCE(organization_id, ''), base, quote, rate_date, source);

ALTER TABLE fx_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rates FORCE ROW LEVEL SECURITY;

CREATE POLICY fx_rates_read ON fx_rates
  FOR SELECT
  USING (organization_id IS NULL OR tenant_visible(organization_id));

CREATE POLICY fx_rates_write ON fx_rates
  FOR ALL
  USING (tenant_visible(organization_id))
  WITH CHECK (tenant_visible(organization_id));
