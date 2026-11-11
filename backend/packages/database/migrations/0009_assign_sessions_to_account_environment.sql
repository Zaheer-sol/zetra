UPDATE sessions AS s
   SET environment = u.default_environment
  FROM users AS u
 WHERE s.user_id = u.id
   AND s.revoked_at IS NULL
   AND s.environment IS DISTINCT FROM u.default_environment;
