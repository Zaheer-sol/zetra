-- Development only. The application connects as zetra_app, which is NOT a superuser,
-- so PostgreSQL row-level security policies are actually enforced.
-- Production: create this role yourself with a strong password (see docs/deployment.md).
CREATE ROLE zetra_app LOGIN PASSWORD 'zetra_app';
CREATE DATABASE zetra_test OWNER zetra;
