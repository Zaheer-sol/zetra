-- One finalized NEAR transaction can settle only one recorded payout.
CREATE UNIQUE INDEX payout_requests_unique_transaction_hash
  ON payout_requests (tx_hash)
  WHERE tx_hash IS NOT NULL;
