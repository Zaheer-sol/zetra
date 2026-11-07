-- Canonical payment-source boundary. This stores provider evidence before it is allowed to create
-- an accounting effect. A connector can be added without changing the ledger or payment matcher.
CREATE TABLE payment_sources (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  environment text NOT NULL CHECK(environment IN ('test','live')),
  kind text NOT NULL CHECK(kind IN ('near','processor')),
  provider text NOT NULL,
  name text NOT NULL,
  secret_ciphertext text NOT NULL,
  secret_hint text,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  last_event_at timestamptz,
  last_error text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, environment, provider, name)
);

CREATE TABLE payment_source_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  environment text NOT NULL CHECK(environment IN ('test','live')),
  source_id text NOT NULL REFERENCES payment_sources(id),
  canonical_key text NOT NULL,
  provider_event_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','processed','ignored','failed')),
  payment_id text REFERENCES payments(id),
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, canonical_key)
);

-- The canonical event and its source identity are evidence. Processing metadata may advance, but
-- the submitted payload can never be rewritten or deleted after receipt.
CREATE FUNCTION guard_payment_source_event_payload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id<>OLD.organization_id OR NEW.environment<>OLD.environment OR NEW.source_id<>OLD.source_id OR
     NEW.canonical_key<>OLD.canonical_key OR NEW.provider_event_id<>OLD.provider_event_id OR NEW.payload<>OLD.payload OR
     NEW.received_at<>OLD.received_at
  THEN RAISE EXCEPTION 'payment source event evidence is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_source_event_evidence_guard BEFORE UPDATE ON payment_source_events FOR EACH ROW EXECUTE FUNCTION guard_payment_source_event_payload();
CREATE TRIGGER payment_source_event_no_delete BEFORE DELETE ON payment_source_events FOR EACH ROW EXECUTE FUNCTION reject_mutation();

ALTER TABLE payment_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_policy ON payment_sources USING (tenant_visible(organization_id)) WITH CHECK (tenant_visible(organization_id));
ALTER TABLE payment_source_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_source_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_policy ON payment_source_events USING (tenant_visible(organization_id)) WITH CHECK (tenant_visible(organization_id));

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zetra_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON payment_sources, payment_source_events TO zetra_app;
  END IF;
END $$;

CREATE INDEX payment_sources_org_status ON payment_sources(organization_id, environment, status);
CREATE INDEX payment_source_events_org_received ON payment_source_events(organization_id, environment, received_at DESC);
CREATE INDEX payment_source_events_source_status ON payment_source_events(source_id, status, received_at DESC);
