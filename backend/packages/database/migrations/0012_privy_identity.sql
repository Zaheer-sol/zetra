ALTER TABLE users
  ADD COLUMN privy_user_id text;

CREATE UNIQUE INDEX users_privy_user_id_unique
  ON users (privy_user_id)
  WHERE privy_user_id IS NOT NULL;
