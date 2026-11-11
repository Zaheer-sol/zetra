ALTER TABLE wallets
  ADD COLUMN is_default boolean NOT NULL DEFAULT false;

-- Preserve an unambiguous existing choice. Organizations with multiple active
-- wallets can select their preferred receiver from the wallet settings screen.
UPDATE wallets AS candidate
SET is_default = true
WHERE candidate.archived_at IS NULL
  AND candidate.monitoring_enabled = true
  AND (
    SELECT count(*)
    FROM wallets AS active
    WHERE active.organization_id = candidate.organization_id
      AND active.environment = candidate.environment
      AND active.archived_at IS NULL
      AND active.monitoring_enabled = true
  ) = 1;

CREATE UNIQUE INDEX wallets_one_default_per_environment
  ON wallets (organization_id, environment)
  WHERE is_default = true AND archived_at IS NULL;
