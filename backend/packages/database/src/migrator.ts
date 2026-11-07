import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadNearNetworks } from "@zetra/config";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * Apply pending SQL migrations in order, each in its own transaction, then sync the network
 * registry. Must run as the schema owner (MIGRATION_DATABASE_URL), not the application role.
 */
export async function migrate(url: string, log: (message: string) => void = console.log): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727372)"); // one migrator at a time
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Set((await client.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        log(`applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
    await syncNetworks(client);
    log("network registry synced");
  } finally {
    await client.query("SELECT pg_advisory_unlock(727372)").catch(() => undefined);
    await client.end();
  }
}

/** Upsert native NEAR networks and assets from the code registry. */
export async function syncNetworks(client: pg.Client | pg.PoolClient, env: Record<string, string | undefined> = process.env): Promise<void> {
  for (const network of loadNearNetworks(env)) {
    await client.query(
      `INSERT INTO network_identities(id, family, environment, name, enabled, config, updated_at)
       VALUES ($1,'near',$2,$3,$4,$5,now())
       ON CONFLICT (id) DO UPDATE SET family='near', environment=excluded.environment,
         name=excluded.name, enabled=excluded.enabled, config=excluded.config, updated_at=now()`,
      [
        network.id,
        network.environment,
        network.name,
        network.enabled,
        JSON.stringify({
          rpcUrl: network.rpcUrl,
          explorerUrl: network.explorerUrl,
          finality: network.finality,
          startHeight: network.startHeight.toString()
        })
      ]
    );
    for (const asset of network.assets) {
      await client.query(
        `INSERT INTO assets(id, network_id, address, symbol, name, decimals, peg_currency, enabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET network_id=excluded.network_id,
           address=excluded.address, symbol=excluded.symbol, name=excluded.name,
           decimals=excluded.decimals, peg_currency=excluded.peg_currency, enabled=excluded.enabled`,
        [asset.id, network.id, asset.contractId, asset.symbol, asset.name, asset.decimals, asset.pegCurrency, network.enabled]
      );
    }
  }
}

/** Drop and recreate the public schema. Development and test databases only. */
export async function resetSchema(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC;");
  } finally {
    await client.end();
  }
}
