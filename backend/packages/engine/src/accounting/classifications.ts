import { type Client } from "@zetra/database";
import { newId, type Environment } from "@zetra/schemas";
import { audit, EngineError, log, type Actor } from "../context";
import { accountById, valueInReporting } from "./chart";
import { ensureBooks } from "./posting-rules";
import { postEntry, reverseEntry } from "./ledger";

type Row = Record<string, any>;

/**
 * A human decision for money Zetra couldn't explain: an unidentified receipt (e.g. an owner
 * contribution, a loan, or other income. It moves the amount out of Payments to Identify into the
 * chosen account.
 */
export async function classifyTransaction(
  client: Client,
  organizationId: string,
  environment: Environment,
  input: { payment_id: string; account_id: string; reason: string },
  actor: Actor
): Promise<Row> {
  const s = await ensureBooks(client, organizationId, environment);
  const account = await accountById(client, organizationId, environment, input.account_id);
  if (account.archived_at) throw new EngineError("account_archived", `Account ${account.code} is archived.`, 422);
  if (account.system_key === "payments_to_identify") throw new EngineError("invalid_account", "Choose the account the money actually belongs to.", 422);
  const id = newId("classification");
  const p = (await client.query("SELECT * FROM payments WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [input.payment_id, organizationId, environment])).rows[0] as Row | undefined;
  if (!p) throw new EngineError("not_found", "No such payment.", 404);
  if (!["needs_review", "dismissed"].includes(p.status)) throw new EngineError("payment_not_unidentified", "Only payments that aren't applied to an invoice can be classified. Applied payments are already accounted for.", 409);
  if ((await client.query(
    "SELECT 1 FROM payout_requests WHERE organization_id = $1 AND environment = $2 AND payment_id = $3 AND kind = 'refund' AND status = ANY($4) LIMIT 1",
    [organizationId, environment, p.id, ["pending_approval", "approved", "submitting", "submitted", "confirmed"]]
  )).rows[0]) throw new EngineError("payment_refund_pending", "This payment has a refund request. Finish or cancel the refund before changing its accounting classification.", 409);
  if (!p.asset_id) throw new EngineError("unsupported_token", "This payment isn't in a supported stablecoin, so it has no accounting value.", 422);
  const receipt = (await client.query("SELECT l.account_id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id WHERE e.organization_id = $1 AND e.environment = $2 AND e.source_key = $3 AND l.credit > 0 LIMIT 1", [organizationId, environment, `pay-receipt:${p.id}`])).rows[0] as Row | undefined;
  if (!receipt) throw new EngineError("not_in_books", "This payment isn't in the books yet (it may still be confirming).", 409);
  const { amount, rateSource } = valueInReporting(p.asset_id, BigInt(p.amount), s.reportingCurrency);
  const refs = { paymentId: p.id, assetId: p.asset_id, assetAmount: BigInt(p.amount), rateSource };
  const description = `Classified received payment from ${p.from_address.slice(0, 6)}…${p.from_address.slice(-4)} as ${account.name}`;
  const lines = [
    { ...refs, accountId: receipt.account_id, debit: amount, memo: "Identified" },
    { ...refs, accountId: account.id, credit: amount, memo: input.reason }
  ];
  await client.query(
    `INSERT INTO transaction_classifications (id, organization_id, environment, kind, payment_id, account_id, reason, actor_type, actor_id, actor_label)
     VALUES ($1,$2,$3,'receipt',$4,$5,$6,$7,$8,$9)`,
    [id, organizationId, environment, input.payment_id, account.id, input.reason, actor.type, actor.id ?? null, actor.label ?? null]
  );
  const { entry } = await postEntry(client, { organizationId, environment, date: new Date(), description, memo: input.reason, sourceType: "classification", sourceId: id, sourceKey: `cls:${id}`, actor, lines: lines as never });
  await audit(client, actor, { organizationId, environment, action: "transaction_classified", objectType: "payment", objectId: input.payment_id, next: { account: `${account.code} ${account.name}`, reason: input.reason, journal_entry_id: entry.id } });
  log().info("transaction_classified", { organizationId, classificationId: id, account: account.code });
  return (await client.query("SELECT * FROM transaction_classifications WHERE id = $1", [id])).rows[0] as Row;
}

/** Reverse a classification: its entry is reversed and the money returns to the holding account to classify again. */
export async function undoClassification(client: Client, organizationId: string, environment: Environment, classificationId: string, reason: string, actor: Actor): Promise<void> {
  const c = (await client.query("SELECT * FROM transaction_classifications WHERE id = $1 AND organization_id = $2 AND environment = $3 FOR UPDATE", [classificationId, organizationId, environment])).rows[0] as Row | undefined;
  if (!c) throw new EngineError("not_found", "No such classification.", 404);
  if (c.reversed_at) throw new EngineError("already_undone", "That classification was already undone.", 409);
  const entry = (await client.query("SELECT id FROM journal_entries WHERE organization_id = $1 AND environment = $2 AND source_key = $3", [organizationId, environment, `cls:${c.id}`])).rows[0] as Row | undefined;
  if (entry) await reverseEntry(client, organizationId, environment, entry.id, { reason: `Classification undone: ${reason}`, actor, sourceKey: `cls-undo:${c.id}`, automatic: true });
  await client.query("UPDATE transaction_classifications SET reversed_at = now(), reversed_by_label = $2, reversal_reason = $3 WHERE id = $1", [c.id, actor.label ?? null, reason]);
  await audit(client, actor, { organizationId, environment, action: "classification_undone", objectType: "payment", objectId: c.payment_id, next: { classification_id: c.id, reason } });
}
