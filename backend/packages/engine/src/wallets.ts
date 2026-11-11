import { resolvePaymentNetwork } from "@zetra/config";
import { isUniqueViolation, type Client } from "@zetra/database";
import { newId, type CreateWalletInput, type Environment } from "@zetra/schemas";
import { audit, EngineError, log, type Actor } from "./context";

/**
 * Receiving wallets: register a public address on a network and the stablecoins it accepts. Validated against the workspace's own data (tenant and mode scoped) and audited.
 */

type Row = Record<string, any>;

export async function createWallet(client: Client, organizationId: string, environment: Environment, input: CreateWalletInput, actor: Actor): Promise<Row> {
  await client.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [organizationId]);
  const existingDefault = await client.query(
    "SELECT 1 FROM wallets WHERE organization_id = $1 AND environment = $2 AND is_default = true AND archived_at IS NULL LIMIT 1",
    [organizationId, environment]
  );
  const isDefault = existingDefault.rowCount === 0;
  const network = resolvePaymentNetwork(input.network, environment);
  if (!network?.enabled) throw new EngineError("network_unavailable", `${capitalize(input.network)} isn't available in ${environment} mode on this deployment.`, 422);
  const assets = input.assets.map((symbol) => {
    const asset = network.assets.find((a) => a.symbol === symbol);
    if (!asset) throw new EngineError("asset_unavailable", `${symbol} isn't supported on ${network.name}.`, 422);
    return asset;
  });
  const id = newId("wallet");
  try {
    await client.query(
      `INSERT INTO wallets (id, organization_id, environment, network_id, name, address, requested_backfill_from_block, created_by, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, organizationId, environment, network.id, input.name, input.address, input.backfill_from_block?.toString() ?? null, actor.id ?? null, isDefault]
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw new EngineError("wallet_exists", "This address is already a receiving wallet on this network.", 409);
    throw error;
  }
  for (const asset of assets) {
    await client.query("INSERT INTO wallet_assets (wallet_id, asset_id, organization_id) VALUES ($1,$2,$3)", [id, asset.id, organizationId]);
  }
  const row = (await client.query("SELECT * FROM wallets WHERE id = $1", [id])).rows[0] as Row;
  await audit(client, actor, { organizationId, environment, action: "wallet_added", objectType: "wallet", objectId: id, next: { address: input.address, network: network.id, assets: input.assets } });
  log().info("wallet_added", { organizationId, walletId: id, networkId: network.id });
  return row;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
