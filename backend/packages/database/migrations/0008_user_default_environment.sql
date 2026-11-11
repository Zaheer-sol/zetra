ALTER TABLE users
  ADD COLUMN default_environment text NOT NULL DEFAULT 'live'
  CHECK (default_environment IN ('test', 'live'));

-- Keep the seeded demo workspace on its simulated dataset when the demo owner signs in.
UPDATE users
   SET default_environment = 'test'
 WHERE lower(email) = 'demo@zetra.local';
