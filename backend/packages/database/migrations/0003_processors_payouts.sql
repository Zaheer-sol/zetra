-- Processor clearing receipts, approval-gated NEAR payouts/refunds and exact gas evidence.
-- Monetary quantities remain integer base units. No signing material is persisted here.

CREATE TABLE processor_receipts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  environment text NOT NULL CHECK(environment IN ('test','live')),
  source_id text NOT NULL REFERENCES payment_sources(id),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  provider_object_id text,
  status text NOT NULL DEFAULT 'succeeded' CHECK(status IN ('pending','succeeded','failed','refunded','disputed','ignored')),
  currency text NOT NULL,
  amount numeric(78,0) NOT NULL CHECK(amount > 0),
  asset_id text REFERENCES assets(id),
  invoice_id text REFERENCES invoices(id),
  customer_id text REFERENCES customers(id),
  payer_email text,
  description text,
  raw jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, provider_event_id)
);

CREATE TABLE processor_receipt_allocations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  environment text NOT NULL CHECK(environment IN ('test','live')),
  receipt_id text NOT NULL REFERENCES processor_receipts(id),
  invoice_id text NOT NULL REFERENCES invoices(id),
  amount numeric(78,0) NOT NULL CHECK(amount > 0),
  kind text NOT NULL DEFAULT 'automatic',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION processor_receipts_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'processor receipts are append-only'; END IF;
  IF NEW.organization_id<>OLD.organization_id OR NEW.environment<>OLD.environment OR NEW.source_id<>OLD.source_id OR
     NEW.provider<>OLD.provider OR NEW.provider_event_id<>OLD.provider_event_id OR NEW.provider_object_id IS DISTINCT FROM OLD.provider_object_id OR
     NEW.currency<>OLD.currency OR NEW.amount<>OLD.amount OR NEW.asset_id IS DISTINCT FROM OLD.asset_id OR
     NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id OR
     NEW.raw<>OLD.raw OR NEW.occurred_at<>OLD.occurred_at OR NEW.received_at<>OLD.received_at
  THEN RAISE EXCEPTION 'processor receipt evidence is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER processor_receipts_evidence_guard BEFORE UPDATE OR DELETE ON processor_receipts FOR EACH ROW EXECUTE FUNCTION processor_receipts_append_only();
CREATE TRIGGER processor_receipt_allocations_no_mutation BEFORE UPDATE OR DELETE ON processor_receipt_allocations FOR EACH ROW EXECUTE FUNCTION reject_mutation();

CREATE TABLE payout_requests (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  environment text NOT NULL CHECK(environment IN ('test','live')),
  kind text NOT NULL CHECK(kind IN ('payment','refund','vendor')),
  wallet_id text NOT NULL REFERENCES wallets(id),
  network_id text NOT NULL REFERENCES network_identities(id),
  asset_id text REFERENCES assets(id),
  token_address text NOT NULL,
  recipient text NOT NULL,
  amount numeric(78,0) NOT NULL CHECK(amount > 0),
  memo text,
  payment_id text REFERENCES payments(id),
  invoice_id text REFERENCES invoices(id),
  vendor_id text REFERENCES vendors(id),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval' CHECK(status IN ('pending_approval','approved','submitting','submitted','confirmed','failed','cancelled')),
  tx_hash text,
  block_hash text,
  error text,
  requested_by text,
  approved_by text,
  cancelled_by text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, environment, idempotency_key)
);

CREATE TABLE payout_attempts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  environment text NOT NULL CHECK(environment IN ('test','live')),
  payout_id text NOT NULL REFERENCES payout_requests(id),
  attempt_number integer NOT NULL,
  status text NOT NULL CHECK(status IN ('submitting','submitted','confirmed','failed')),
  tx_hash text,
  block_hash text,
  gas_burnt numeric(78,0),
  tokens_burnt numeric(78,0),
  fee_yoctonear numeric(78,0),
  raw jsonb NOT NULL DEFAULT '{}',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(payout_id, attempt_number)
);

CREATE TABLE network_fee_records (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  environment text NOT NULL CHECK(environment IN ('test','live')),
  payout_attempt_id text NOT NULL UNIQUE REFERENCES payout_attempts(id),
  wallet_id text NOT NULL REFERENCES wallets(id),
  network_id text NOT NULL REFERENCES network_identities(id),
  symbol text NOT NULL DEFAULT 'NEAR',
  fee_yoctonear numeric(78,0) NOT NULL CHECK(fee_yoctonear >= 0),
  fee_reporting_micros numeric(78,0),
  rate_source text,
  status text NOT NULL DEFAULT 'unvalued' CHECK(status IN ('valued','unvalued')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER payout_attempts_no_mutation BEFORE UPDATE OR DELETE ON payout_attempts FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER network_fee_records_no_mutation BEFORE UPDATE OR DELETE ON network_fee_records FOR EACH ROW EXECUTE FUNCTION reject_mutation();

ALTER TABLE journal_lines ADD COLUMN processor_receipt_id text REFERENCES processor_receipts(id);
ALTER TABLE journal_lines ADD COLUMN payout_attempt_id text REFERENCES payout_attempts(id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['processor_receipts','processor_receipt_allocations','payout_requests','payout_attempts','network_fee_records'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_policy ON %I USING (tenant_visible(organization_id)) WITH CHECK (tenant_visible(organization_id))',t);
  END LOOP;
END $$;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zetra_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON processor_receipts, processor_receipt_allocations, payout_requests, payout_attempts, network_fee_records TO zetra_app;
  END IF;
END $$;

CREATE INDEX processor_receipts_org_time ON processor_receipts(organization_id, environment, occurred_at DESC);
CREATE INDEX processor_receipts_invoice ON processor_receipts(invoice_id, status);
CREATE INDEX processor_receipt_allocations_invoice ON processor_receipt_allocations(invoice_id, created_at);
CREATE INDEX payout_requests_due ON payout_requests(status, updated_at);
CREATE INDEX payout_requests_org_time ON payout_requests(organization_id, environment, requested_at DESC);
CREATE INDEX payout_attempts_payout ON payout_attempts(payout_id, attempt_number);
CREATE INDEX network_fee_records_org_time ON network_fee_records(organization_id, environment, created_at DESC);
