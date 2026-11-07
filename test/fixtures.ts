import { randomBytes } from "node:crypto";
import { withSystem, withTenant } from "../backend/packages/database/src";
import { createCustomer, createInvoice, createWallet, type Actor, type ObservationInput, type WalletRef } from "../backend/packages/engine/src";
import { newId, toBaseUnits } from "../backend/packages/schemas/src";

export interface Workspace {
  orgId: string;
  environment: "test";
  wallet: WalletRef;
  actor: Actor;
  customers: Record<string, { id: string; address?: string }>;
}

let sequence = 1n;
export const usd = (value: string) => toBaseUnits(value, 6);
export const randomAddress = () => `acct-${randomBytes(10).toString("hex")}.testnet`;

export async function workspace(): Promise<Workspace> {
  const orgId = newId("organization");
  const userId = newId("user");
  const actor: Actor = { type: "user", id: userId, label: `${userId}@zetra.test` };
  await withSystem(async (client) => {
    await client.query("INSERT INTO users (id,email,name) VALUES ($1,$2,'Test Owner')", [userId, `${userId}@zetra.test`]);
    await client.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'Test Workspace',$2)", [orgId, orgId]);
    await client.query("INSERT INTO organization_members (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')", [newId("member"), orgId, userId]);
  });
  return withTenant(orgId, async (client) => {
    const wallet = (await createWallet(client, orgId, "test", { name: "Receiving", network: "near:testnet", address: randomAddress(), assets: ["USDC"] }, actor)) as WalletRef;
    const customers: Workspace["customers"] = {};
    for (const name of ["Acme Ltd", "Nova Systems", "Studio Ten"]) {
      const address = randomAddress();
      const customer = await createCustomer(client, orgId, "test", { name, email: `${name.toLowerCase().replaceAll(" ", "-")}@test.invalid`, metadata: {}, wallet_addresses: [{ address, network: "near:testnet" }] }, actor);
      customers[name] = { id: customer.id, address };
    }
    return { orgId, environment: "test" as const, wallet, actor, customers };
  });
}

export async function invoice(ws: Workspace, customerName: string, amount: string, options: { number?: string; title?: string } = {}) {
  return withTenant(ws.orgId, (client) =>
    createInvoice(client, ws.orgId, "test", {
      customer_id: ws.customers[customerName]!.id,
      number: options.number,
      title: options.title ?? "Services",
      amount,
      currency: "USD",
      asset: "USDC",
      network: "near:testnet",
      metadata: {}
    }, ws.actor)
  );
}

export function transfer(
  ws: Workspace,
  amount: bigint,
  fromAddress: string,
  overrides: Partial<ObservationInput> = {}
): ObservationInput {
  const n = sequence++;
  return {
    sourceType: "nep141_transfer",
    networkId: "near:testnet",
    blockNumber: n,
    blockHash: `block-${n}-${randomBytes(8).toString("hex")}`,
    transactionHash: `tx-${n}-${randomBytes(12).toString("hex")}`,
    transactionIndex: 0,
    logIndex: 0,
    outcomeId: `outcome-${n}`,
    transferIndex: 0,
    assetId: "near_testnet_usdc",
    tokenAddress: "usdc.fakes.testnet",
    fromAddress,
    toAddress: ws.wallet.address,
    amount,
    blockTimestamp: new Date(),
    raw: {},
    ...overrides
  };
}
