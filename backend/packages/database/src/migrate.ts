import { loadEnvFile } from "./load-env";
import { migrate } from "./migrator";

loadEnvFile();
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Set MIGRATION_DATABASE_URL (schema owner) or DATABASE_URL.");
  process.exit(1);
}

// Provision the restricted runtime role before applying migrations so each migration can grant it
// only the permissions it needs. The migration URL must use the database owner; application
// processes derive a zetra_app URL from that host using this same password.
if (process.env.APP_DB_PASSWORD) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const role = await client.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zetra_app') AS exists");
    const statement = role.rows[0]?.exists
      ? "ALTER ROLE zetra_app WITH LOGIN PASSWORD %L"
      : "CREATE ROLE zetra_app LOGIN PASSWORD %L";
    const sql = (await client.query<{ sql: string }>("SELECT format($1::text, $2::text) AS sql", [statement, process.env.APP_DB_PASSWORD])).rows[0]!.sql;
    await client.query(sql);
    console.log("restricted application role provisioned");
  } finally {
    await client.end();
  }
}

await migrate(url);
