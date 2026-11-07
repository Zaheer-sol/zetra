import { type Client } from "@zetra/database";
import { type Environment } from "@zetra/schemas";
import { EngineError } from "../context";
import { accountById, systemAccount } from "./chart";

type Row = Record<string, any>;

export async function spendAccount(client: Client, organizationId: string, environment: Environment, accountId: string | null | undefined, vendor: Row | null): Promise<Row> {
  const id = accountId ?? vendor?.default_account_id ?? (await systemAccount(client, organizationId, environment, "general_expense")).id;
  const a = await accountById(client, organizationId, environment, id);
  if (!["expense", "cogs", "asset"].includes(a.type) || a.subtype === "cash") throw new EngineError("invalid_account", "Choose an expense, cost of goods or (non-cash) asset account.", 422);
  if (a.archived_at) throw new EngineError("account_archived", `Account ${a.code} is archived.`, 422);
  return a;
}

export async function paidFromAccount(client: Client, organizationId: string, environment: Environment, accountId: string): Promise<Row> {
  const a = await accountById(client, organizationId, environment, accountId);
  if (a.wallet_id) throw new EngineError("invalid_account", "Choose a bank, cash, equity, or liability account for this recorded payment.", 422);
  if (!(a.subtype === "cash" || a.type === "equity" || a.type === "liability")) throw new EngineError("invalid_account", "Pay from a bank/cash account, an owner's equity account (paid personally) or a liability account (card, loan).", 422);
  return a;
}
