-- Associate wallet-signed NEAR vendor payouts with the bill they settle.
ALTER TABLE payout_requests
  ADD COLUMN bill_id text REFERENCES bills(id);

CREATE INDEX payout_requests_bill_status
  ON payout_requests (organization_id, environment, bill_id, status)
  WHERE bill_id IS NOT NULL;

ALTER TABLE payout_attempts
  ADD COLUMN storage_deposit_yocto numeric(78,0) NOT NULL DEFAULT 0
  CHECK (storage_deposit_yocto >= 0);
